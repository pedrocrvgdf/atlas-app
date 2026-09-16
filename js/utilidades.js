/**
 * ============================================================================
 * UTILIDADES - Funções compartilhadas em todo o app
 * ============================================================================
 */

const Utilidades = {

  /**
   * V491: Parser numérico pt-BR ÚNICO para todo o app.
   *
   * Corrige o padrão antigo `replace(/\./g,'').replace(',','.')` que removia
   * TODOS os pontos sem checar se havia vírgula — "150.75" virava 15075 e
   * "8.5" virava 85. Regra (mesma do _numero do importador_laudos, que já
   * estava correta):
   *   - Tem vírgula  → formato BR: ponto = milhar, vírgula = decimal
   *   - Sem vírgula  → ponto (se houver) É o decimal
   * "1.234,56" → 1234.56 · "150.75" → 150.75 · "8,5" → 8.5 · "1234" → 1234
   *
   * @param {*} v       valor cru (string/number/null)
   * @param {*} padrao  retorno quando não numérico (default null)
   */
  parseNumBR(v, padrao = null) {
    if (v == null || v === '') return padrao;
    if (typeof v === 'number') return Number.isFinite(v) ? v : padrao;
    let s = String(v).replace(/[R$\s ]/g, '').trim();
    if (!s) return padrao;
    if (s.includes(',')) {
      s = s.replace(/\./g, '').replace(/,/g, '.');
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : padrao;
  },

  /**
   * V492: injeta o CSS de um módulo UMA vez no <head> (em vez de re-parsear
   * <style> inteiro dentro do innerHTML a cada render). Se o CSS mudar
   * (módulos com CSS dinâmico), atualiza o conteúdo do mesmo <style>.
   * Uso: Utilidades.garantirEstilos('css-meu-modulo', CSS) antes do render,
   * e remover o `<style>${CSS}</style>` do template.
   */
  garantirEstilos(id, css) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('style');
      el.id = id;
      document.head.appendChild(el);
    }
    if (el.textContent !== css) el.textContent = css;
  },

  /**
   * Card totalizador padrão ATLAS (componente AIC: moldura atrás + cartão na frente).
   * @param {string} label    rótulo em cima
   * @param {string} valor    valor grande (pode conter <small>)
   * @param {string} meta     linha menor embaixo
   * @param {string} variante '' | 'alerta' | 'glosa'
   * @param {string} cls      classes extras no container (ex.: 'calc-kpi-clicavel aic--ativo')
   * @param {string} attrs    atributos extras (ex.: 'data-filtro="glosa" title="..."')
   */
  cardKPI(label, valor, meta, variante = '', cls = '', attrs = '') {
    const mod = variante ? ` aic--${variante}` : '';
    return `
      <div class="aic${mod}${cls ? ' ' + cls : ''}" ${attrs}>
        <div class="aic-verde"></div>
        <div class="aic-branco">
          <div class="aic-lbl">${label}</div>
          <div class="aic-val">${valor}</div>
          <div class="aic-meta">${meta}</div>
        </div>
      </div>
    `;
  },

  /**
   * Normaliza string para comparação:
   *  - Remove acentos
   *  - Maiúsculas
   *  - Substitui pontuação (-/_.,;:()) por espaço
   *  - Colapsa múltiplos espaços
   *
   * Exemplo:
   *   "Calázio - - Exerese"  → "CALAZIO EXERESE"
   *   "Calazio   exerese"    → "CALAZIO EXERESE"
   *
   * Esta é a função MAIS IMPORTANTE: resolve a maior dor do projeto
   * (mesmo procedimento aparecer com várias grafias).
   */
  normalizar(texto) {
    if (texto === null || texto === undefined) return '';
    let s = String(texto);

    // Remove acentos
    s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // Maiúsculas
    s = s.toUpperCase();

    // Substitui pontuação por espaço
    s = s.replace(/[\/\-_.,;:()\\]/g, ' ');

    // Colapsa múltiplos espaços
    s = s.replace(/\s+/g, ' ').trim();

    return s;
  },

  /**
   * Calcula similaridade entre duas strings (0.0 a 1.0).
   * Usa Levenshtein normalizado (simples, sem dependência externa).
   *
   * Exemplos:
   *   similaridade("Tiago Suzuki", "TIAGO SUZUKI GODOY") → ~0.71
   *   similaridade("Katia", "Karla")                       → ~0.6
   */
  similaridade(a, b) {
    a = this.normalizar(a);
    b = this.normalizar(b);
    if (a === b) return 1.0;
    if (!a || !b) return 0.0;

    const distancia = this._levenshtein(a, b);
    return 1.0 - distancia / Math.max(a.length, b.length);
  },

  /** Distância de Levenshtein (privado). */
  _levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;

    let prev = new Array(n + 1);
    let curr = new Array(n + 1);

    for (let j = 0; j <= n; j++) prev[j] = j;

    for (let i = 1; i <= m; i++) {
      curr[0] = i;
      for (let j = 1; j <= n; j++) {
        const custo = a[i - 1] === b[j - 1] ? 0 : 1;
        curr[j] = Math.min(
          curr[j - 1] + 1,        // inserção
          prev[j] + 1,            // deleção
          prev[j - 1] + custo     // substituição
        );
      }
      [prev, curr] = [curr, prev];
    }
    return prev[n];
  },

  /** Formata valor monetário em Real (R$). */
  formatarMoeda(valor) {
    if (valor === null || valor === undefined || isNaN(valor)) return '—';
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(valor);
  },

  /** Formata número inteiro com separador de milhar. */
  /**
   * Formata número no padrão pt-BR.
   * @param n {number} valor
   * @param casas {number} casas decimais fixas (opcional). Se omitido,
   *   usa as casas naturais do número (sem zeros à direita).
   *
   * Ex: formatarNumero(15111) → "15.111"
   *     formatarNumero(15111, 2) → "15.111,00"
   *     formatarNumero(15111.5, 2) → "15.111,50"
   *     formatarNumero(15111.567, 0) → "15.112" (arredonda)
   */
  formatarNumero(n, casas) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    const opts = {};
    if (typeof casas === 'number' && casas >= 0) {
      opts.minimumFractionDigits = casas;
      opts.maximumFractionDigits = casas;
    }
    return new Intl.NumberFormat('pt-BR', opts).format(n);
  },

  /**
   * V247: "visão do Produzido" — regra ÚNICA usada em Consolidado, Calcular e Auditoria.
   *  • PARTICULAR pago por % (status 'casou' + base ≠ repasse) → produzido bruto do QVIS (número)
   *  • CONVÊNIO (qualquer status)                              → texto 'PROD. CONV'
   *  • demais (SUS, particular fixo, glosa, linhas-filhas…)    → null (em branco)
   * Recebe a linha crua (origem, _status, _valorBase, _repasse, produzido).
   */
  produzidoView(l) {
    if (!l) return null;
    const origem = String(l.origem == null ? '' : l.origem)
      .toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    // V248: perfil particular configurado pra seguir a TABELA DE CONVÊNIO conta como
    // convênio aqui — mesmo a origem do QVIS sendo PARTICULAR, mostra 'PROD. CONV'.
    const perfilSegueConv = !!l._regraPerfil &&
      String(l._perfilTabela == null ? '' : l._perfilTabela).toUpperCase().trim() === 'CONVENIO';
    if (perfilSegueConv) return 'PROD. CONV';
    if (origem.startsWith('PART')) {
      // V250: linha de fichário (Desempenho) percentual carrega a base produzida em l.produzido (flag _fichProd).
      if (l._fichProd) { const pb = Number(l.produzido) || 0; return pb > 0 ? pb : null; }
      const vb = Number(l._valorBase) || 0, rp = Number(l._repasse) || 0;
      const ehPct = vb > 0.005 && Math.abs(vb - rp) > 0.005;
      return (l._status === 'casou' && ehPct) ? (Number(l.produzido) || 0) : null;
    }
    if (origem.startsWith('CONV')) return 'PROD. CONV';
    return null;
  },

  /** V247: célula pronta da visão do Produzido (número → R$, texto → como está, null → ''). */
  produzidoViewCell(l) {
    const p = this.produzidoView(l);
    if (p == null) return '';
    return (typeof p === 'number') ? ('R$ ' + this.formatarNumero(p, 2)) : p;
  },

  /** Formata percentual: 0.18 → "18%" */
  /**
   * V708: REGRA DE EXPORTAÇÃO da ferramenta — em QUALQUER export, coluna de
   * percentual sai exibida como "2,5%" e coluna de dinheiro como "R$ 300,00"
   * (formato Contábil), mantendo o NÚMERO por baixo (dá pra somar no Excel).
   * Uso: depois do aoa_to_sheet → Utilidades.aplicarFormatosExport(ws,
   *   { moeda: [11, 14], pct: [13] }, 1)  // índices de coluna 0-based;
   *   linhaIni pula o cabeçalho.
   */
  FMT_EXPORT_MOEDA: '_-"R$" * #,##0.00_-;-"R$" * #,##0.00_-;_-"R$" * "-"??_-;_-@_-',
  FMT_EXPORT_PCT: '0.##"%"',
  aplicarFormatosExport(ws, cols, linhaIni = 1) {
    try {
      if (!ws || !ws['!ref'] || typeof XLSX === 'undefined') return ws;
      const faixa = XLSX.utils.decode_range(ws['!ref']);
      const moeda = (cols && cols.moeda) || [];
      const pct = (cols && cols.pct) || [];
      for (let r = linhaIni; r <= faixa.e.r; r++) {
        for (const c of moeda) {
          const cel = ws[XLSX.utils.encode_cell({ r, c })];
          if (cel && typeof cel.v === 'number') cel.z = this.FMT_EXPORT_MOEDA;
        }
        for (const c of pct) {
          const cel = ws[XLSX.utils.encode_cell({ r, c })];
          if (cel && typeof cel.v === 'number') cel.z = this.FMT_EXPORT_PCT;
        }
      }
    } catch (e) { console.warn('[export] formatos:', e); }
    return ws;
  },

  /**
   * V716: MENU DE EXPORTAÇÃO PADRÃO da ferramenta (modelo do módulo LIO).
   * Todo "Exportar" com opções deve usar este componente: popup com título
   * "EXPORTAR EXCEL", itens com ícone em quadradinho + título em negrito +
   * subtítulo, e separadores entre grupos. CSS central: .atlas-menu-exp
   * (css/style.css).
   *
   * Uso:
   *   Utilidades.abrirMenuExportar(botao, [
   *     { icone: '⊞', titulo: 'Todos', sub: 'Tudo numa aba', onClick: () => ... },
   *     'sep',
   *     { icone: '⌖', titulo: 'Por Mês', sub: mesLabel, aviso: !mes, onClick: ... },
   *     { icone: '✓', titulo: 'Com regra', sub: '...', tom: 'verde', onClick: ... },
   *   ], { titulo: 'Exportar Excel' });
   *
   * tons do ícone: 'conv' | 'part' | 'adic' | 'verde' | 'vermelho' (default azul).
   * `aviso: true` esmaece o título e pinta o subtítulo de laranja (pré-requisito
   * faltando) — o clique ainda chama onClick (o handler decide avisar/abortar).
   */
  abrirMenuExportar(ancora, itens, opts = {}) {
    document.querySelectorAll('.atlas-menu-exp').forEach(el => el.remove());
    const esc = (s) => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const menu = document.createElement('div');
    menu.className = 'atlas-menu-exp';
    menu.innerHTML = `<div class="atlas-menu-exp-titulo">${esc(opts.titulo || 'Exportar Excel')}</div>` +
      itens.map((it, i) => {
        if (it === 'sep') return '<div class="atlas-menu-sep"></div>';
        const tom = it.tom ? ` atlas-menu-item-${it.tom}` : '';
        const aviso = it.aviso ? ' atlas-menu-item-aviso' : '';
        return `
          <button class="atlas-menu-item${tom}${aviso}" data-idx="${i}">
            <span class="atlas-menu-item-ico">${it.icone || '⊞'}</span>
            <div>
              <strong>${esc(it.titulo)}</strong>
              ${it.sub ? `<small>${esc(it.sub)}</small>` : ''}
            </div>
          </button>`;
      }).join('');
    document.body.appendChild(menu);

    // âncora: botão visível → ele; oculto (absorvido pelo leque #atlas-hub) →
    // o leque; senão canto sup. direito. Sempre clampado pra dentro da viewport.
    let r = ancora && ancora.getBoundingClientRect ? ancora.getBoundingClientRect() : { width: 0, height: 0 };
    if (!r.width && !r.height) {
      const hub = document.querySelector('#atlas-hub .hub-btn');
      if (hub) r = hub.getBoundingClientRect();
    }
    let topo = (r.bottom || 70) + window.scrollY + 6;
    let esq = (r.right || window.innerWidth - 20) - menu.offsetWidth + window.scrollX;
    esq = Math.max(8, Math.min(esq, window.innerWidth - menu.offsetWidth - 8));
    topo = Math.max(8, Math.min(topo, window.scrollY + window.innerHeight - menu.offsetHeight - 8));
    menu.style.top = `${topo}px`;
    menu.style.left = `${esq}px`;

    const fechar = (ev) => {
      if (ev && menu.contains(ev.target)) return;
      menu.remove();
      document.removeEventListener('click', fechar);
    };
    setTimeout(() => document.addEventListener('click', fechar), 0);

    menu.querySelectorAll('.atlas-menu-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const it = itens[Number(btn.dataset.idx)];
        menu.remove();
        document.removeEventListener('click', fechar);
        if (it && typeof it.onClick === 'function') it.onClick();
      });
    });
    return menu;
  },

  formatarPercentual(p) {
    if (p === null || p === undefined || isNaN(p)) return '—';
    return (p * 100).toFixed(1).replace('.', ',') + '%';
  },

  /** Sanitiza nome para uso em arquivo */
  sanitizarNomeArquivo(nome) {
    return String(nome)
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);
  },

  /**
   * Tipos de vínculo de médico (catálogo central).
   * V960: PADRÃO ÚNICO da tag de vínculo em toda a ferramenta (como a fonte
   * pagadora, V946/V947) — pílula clara com texto escuro, só cores da paleta
   * do sistema (tokens do :root):
   *   Interno = --primary #5980a6 sobre --primary-soft #eef2f6
   *   Híbrido = --warning #B8864A (borda) · texto #8A6420 sobre --warning-soft #F4E8D2
   *   Externo = --ink-soft #585d62 sobre --bg-sunken #eef2f6 · borda --border-strong
   * CSS em css/style.css (.atlas-vinc). `bg/fg/bd` ficam como referência das
   * cores (os módulos não devem mais pintar inline).
   */
  TIPOS_VINCULO: {
    INTERNO: { label: 'Interno', cls: 'int', bg: '#eef2f6', fg: '#5980a6', bd: 'rgba(89, 128, 166,.35)' },
    HIBRIDO: { label: 'Híbrido', cls: 'hib', bg: '#F4E8D2', fg: '#8A6420', bd: '#B8864A' },
    EXTERNO: { label: 'Externo', cls: 'ext', bg: '#eef2f6', fg: '#585d62', bd: '#e4eaf1' },
  },
  /** V960: normaliza qualquer grafia ('Interno', 'HIB', 'HÍB', 'ext', 'EXTERNO'…) → chave ou null */
  chaveVinculo(v) {
    const t = this.normalizar(v || '');
    if (!t) return null;
    if (t.startsWith('INT')) return 'INTERNO';
    if (t.startsWith('HIB')) return 'HIBRIDO';
    if (t.startsWith('EXT')) return 'EXTERNO';
    return null;
  },
  /** V960: rótulo uniforme — 'Interno' | 'Híbrido' | 'Externo' | (o que veio) */
  rotuloVinculo(v) {
    const k = this.chaveVinculo(v);
    return k ? this.TIPOS_VINCULO[k].label : (v == null ? '' : String(v));
  },
  /** V960: classe da tag ('int' | 'hib' | 'ext' | null) */
  classeVinculo(v) {
    const k = this.chaveVinculo(v);
    return k ? this.TIPOS_VINCULO[k].cls : null;
  },
  /** V960: a TAG padrão — <span class="atlas-vinc atlas-vinc-int">Interno</span>; vazio se não for vínculo */
  badgeVinculo(v) {
    const k = this.chaveVinculo(v);
    if (!k) return '';
    const t = this.TIPOS_VINCULO[k];
    return `<span class="atlas-vinc atlas-vinc-${t.cls}">${t.label}</span>`;
  },
  /** V960: cores da tag de vínculo no EXCEL (mesmas da tela) — fundo + texto, ARGB */
  VINCULO_EXCEL: { int: { fill: 'FFE1EFF6', font: 'FF005073' }, hib: { fill: 'FFF4E8D2', font: 'FF8A6420' }, ext: { fill: 'FFE4EEF4', font: 'FF3A5464' } },
  /** V960: pinta uma célula ExcelJS como a tag de vínculo e grava o rótulo uniforme */
  pintarCelulaVinculo(cell, v) {
    if (!cell) return;
    const cls = this.classeVinculo(v);
    const rot = this.rotuloVinculo(v);
    cell.value = rot || (cell.value == null ? '' : cell.value);
    if (!cls) return;
    const c = this.VINCULO_EXCEL[cls];
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.fill } };
    cell.font = Object.assign({}, cell.font || {}, { bold: true, color: { argb: c.font } });
    cell.alignment = Object.assign({}, cell.alignment || {}, { horizontal: 'center', vertical: 'middle' });
  },

  /**
   * Gera o HTML de um badge de tipo de vínculo (Interno/Híbrido/Externo).
   * Retorna string vazia se o tipo for null/inválido. (V960: alias de badgeVinculo)
   */
  /**
   * V946: TAG DE FONTE PAGADORA — padrão único da ferramenta (pílula clara,
   * borda fina, texto colorido, caixa alta): Convênio azul #3f6489 ·
   * Particular âmbar (#F8E3A1 / #D9B66B) · SUS verde #0E7A57. Qualquer outra
   * origem sai neutra com o texto que veio. CSS em css/style.css (.atlas-fonte).
   */
  badgeFonte(origem, rotulo) {
    const f = this.normalizar(origem || '');
    let cls = 'outra', label = rotulo || (origem ? String(origem) : '—');
    if (f.startsWith('CONV')) { cls = 'conv'; label = rotulo || 'Convênio'; }
    else if (f.startsWith('PART')) { cls = 'part'; label = rotulo || 'Particular'; }
    else if (f === 'SUS' || f.startsWith('SUS ')) { cls = 'sus'; label = rotulo || 'SUS'; }
    const esc = String(label).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    return `<span class="atlas-fonte atlas-fonte-${cls}">${esc}</span>`;
  },

  /** V947: rótulo uniforme da fonte pagadora — 'Convênio' | 'Particular' | 'SUS' | (o que veio) */
  rotuloFonte(origem) {
    const f = this.normalizar(origem || '');
    if (f.startsWith('CONV')) return 'Convênio';
    if (f.startsWith('PART')) return 'Particular';
    if (f === 'SUS' || f.startsWith('SUS ')) return 'SUS';
    return origem == null ? '' : String(origem);
  },
  /** V947: classe da fonte ('conv' | 'part' | 'sus' | null) */
  classeFonte(origem) {
    const f = this.normalizar(origem || '');
    return f.startsWith('CONV') ? 'conv' : f.startsWith('PART') ? 'part' : (f === 'SUS' || f.startsWith('SUS ')) ? 'sus' : null;
  },
  /** V947: cores da tag no EXCEL (mesmas da tela) — fundo + texto, ARGB */
  FONTE_EXCEL: { conv: { fill: 'FFE3F2FA', font: 'FF189AD3' }, part: { fill: 'FFF8E3A1', font: 'FF6B4E12' }, sus: { fill: 'FFDDF5EA', font: 'FF0E7A57' } },
  /**
   * V947: pinta uma célula ExcelJS como a tag da tela e grava o rótulo uniforme.
   * Uso: Utilidades.pintarCelulaFonte(row.getCell('origem'), l.origem)
   */
  pintarCelulaFonte(cell, origem) {
    if (!cell) return;
    const cls = this.classeFonte(origem);
    const rot = this.rotuloFonte(origem);
    cell.value = rot || (cell.value == null ? '' : cell.value);
    if (!cls) return;
    const c = this.FONTE_EXCEL[cls];
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.fill } };
    cell.font = Object.assign({}, cell.font || {}, { bold: true, color: { argb: c.font } });
    cell.alignment = Object.assign({}, cell.alignment || {}, { horizontal: 'center', vertical: 'middle' });
  },

  badgeTipoVinculo(tipo) {
    return this.badgeVinculo(tipo);
  },

  /**
   * Cargos administrativos (catálogo central).
   * Mutuamente exclusivo: cada médico tem no máximo 1 cargo.
   * Estilo metálico (dourado/prata/bronze) com sigla compacta.
   *
   * SÓCIO é diferente dos demais: NÃO é cargo administrativo, é apenas
   * uma marca informativa. Não aparece nos fichários de cargo nem gera
   * valor. Estilo distinto (círculo verde) para deixar isso claro.
   */
  CARGOS_ADMIN: {
    DIRETORIA_TECNICA: {
      sigla: 'DT',
      label: 'Diretoria Técnica',
      bgGradient: 'linear-gradient(135deg, #E8C667 0%, #9B7A2C 100%)',
      fg: '#2E1F08',
      bd: '#6B5018',
      shadow: 'rgba(139, 105, 40, 0.4)',
      ehSocio: false,
    },
    DIRETORIA_CLINICA: {
      sigla: 'DC',
      label: 'Diretoria Clínica',
      bgGradient: 'linear-gradient(135deg, #F8E3A1 0%, #D9B66B 100%)',
      fg: '#5C4319',
      bd: '#A8843B',
      shadow: 'rgba(217, 182, 107, 0.4)',
      ehSocio: false,
    },
    COORDENADOR_MEDICO: {
      sigla: 'CM',
      label: 'Coordenador Médico',
      bgGradient: 'linear-gradient(135deg, #E5E7EA 0%, #A8AAB0 100%)',
      fg: '#2A2A2A',
      bd: '#6B6B6B',
      shadow: 'rgba(168, 170, 176, 0.4)',
      ehSocio: false,
    },
    RESPONSAVEL_TECNICO: {
      sigla: 'RT',
      label: 'Responsável Técnico',
      bgGradient: 'linear-gradient(135deg, #D4955E 0%, #8B5A2B 100%)',
      fg: '#fafbfc',
      bd: '#5A3A1A',
      shadow: 'rgba(139, 90, 43, 0.4)',
      ehSocio: false,
    },
    SOCIO: {
      sigla: 'S',
      label: 'Sócio',
      bg: '#D8EAD3',                // fundo verde claro
      fg: '#4f8a5b',                // letra verde escura
      bd: '#4f8a5b',                // borda verde escura
      ehSocio: true,                // flag: NÃO gera pagamento
    },
  },

  /**
   * Gera o HTML do badge de cargo administrativo.
   * Compacto, fica DEPOIS do nome do médico (sufixo).
   * Mostra sigla (DT/DC/CM/RT) — nome completo aparece no tooltip ao hover.
   *
   * Caso especial: SOCIO usa estilo circular verde (não é cargo, só marca).
   *
   * Se passar `nomeExcecao`, exibe um asterisco dourado (*) indicando que
   * este médico tem regra especial para essa TAG (sobrescreve o valor fixo).
   * (Asterisco só faz sentido em cargos administrativos, não em Sócio.)
   */
  badgeCargoAdmin(cargo, nomeExcecao) {
    if (!cargo || !this.CARGOS_ADMIN[cargo]) return '';
    const c = this.CARGOS_ADMIN[cargo];

    // SÓCIO: estilo circular verde, sem exceção
    if (c.ehSocio) {
      return `<span class="badge-socio" title="${c.label}"
        style="background:${c.bg};color:${c.fg};border-color:${c.bd}">${c.sigla}</span>`;
    }

    // Demais cargos: badge retangular metálico (DT, DC, CM, RT)
    const tooltip = nomeExcecao
      ? `${c.label} · Exceção: ${nomeExcecao}`
      : c.label;
    const sup = nomeExcecao
      ? '<sup style="color:#3f6489;font-size:7px;margin-left:1px;font-weight:800">*</sup>'
      : '';
    return `<span class="badge-cargo" title="${tooltip}"
      style="background:${c.bgGradient};color:${c.fg};border-color:${c.bd};box-shadow:0 1px 2px ${c.shadow}">${c.sigla}${sup}</span>`;
  },

  /** Mostra um toast (notificação rápida) */
  toast(mensagem, tipo = 'info', duracao = 3000) {
    // Remove toasts existentes
    document.querySelectorAll('.toast').forEach(t => t.remove());

    const el = document.createElement('div');
    el.className = `toast ${tipo}`;
    el.textContent = mensagem;
    document.body.appendChild(el);

    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 200ms';
      setTimeout(() => el.remove(), 200);
    }, duracao);
  },

  /** Mostra overlay de loading com o spinner 3D Atlas.
   *  opts.semFundo = true → mostra SÓ os anéis (fundo transparente, sem tela
   *  escura cobrindo o conteúdo); usado nas travadas internas (filtros etc). */
  mostrarLoading(mensagem = 'Carregando', opts = {}) {
    // V672: remove NA HORA qualquer overlay anterior — inclusive um em fade-out.
    // Antes: o esconderLoading() marcava o antigo pra sumir em 260ms e o novo
    // nascia com o MESMO id; dois loadings encadeados (ex.: navegação + tela
    // pesada que abre o seu próprio) deixavam o esconder seguinte pegando o
    // overlay VELHO (getElementById devolve o primeiro) e o novo ficava
    // girando pra sempre — o "loading fantasma".
    document.querySelectorAll('#app-loading-overlay').forEach(el => el.remove());
    const overlay = document.createElement('div');
    overlay.id = 'app-loading-overlay';
    overlay.className = 'loading-overlay' + (opts.semFundo ? ' sem-fundo' : '');
    overlay.innerHTML = opts.semFundo
      ? `<div class="atlas-loader"></div>`
      : `<div class="atlas-loader"></div><div class="message">${mensagem}</div>`;
    document.body.appendChild(overlay);
  },

  esconderLoading() {
    // V672: esconde TODOS os overlays com o id (podem ter se acumulado)
    document.querySelectorAll('#app-loading-overlay').forEach(ex => {
      ex.classList.add('is-out');
      setTimeout(() => ex.remove(), 260);
    });
  },

  /** Espera o navegador efetivamente pintar (2 quadros + tick). Necessário para
   *  que a tela de loading APAREÇA antes de um processamento síncrono pesado
   *  travar a thread principal. */
  aguardarPintura() {
    // V672: em aba OCULTA o requestAnimationFrame não dispara — um comLoading
    // iniciado com a aba em segundo plano ficava pendurado (overlay eterno)
    if (document.visibilityState === 'hidden') return new Promise(r => setTimeout(r, 0));
    return new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0)));
    });
  },

  /** Roda `fn` exibindo o loading durante a travada — ideal para abrir telas
   *  pesadas e aplicar filtros que congelam 1-2s. Mostra o loading, deixa o
   *  navegador pintar, executa `fn` (sync ou async) e esconde no final.
   *  opts.semFundo = true → só os anéis, sem a tela escura. */
  async comLoading(fn, mensagem = 'Carregando', opts = {}) {
    this.mostrarLoading(mensagem, opts);
    await this.aguardarPintura();
    try {
      return await fn();
    } finally {
      this.esconderLoading();
    }
  },

  /** Confirmação simples (substitui window.confirm com estilo) */
  async confirmar(mensagem) {
    return window.confirm(mensagem); // simples por enquanto
  },

  // ============================================================================
  // QVIS Snapshots — multi-snapshot model
  // ============================================================================
  // O banco linhas_qvis pode ter VÁRIOS snapshots ao mesmo tempo. Cada snapshot
  // representa um arquivo importado (mes_pagamento + origem). Como linhas
  // de competências antigas aparecem em vários snapshots (ex: admissão de
  // Nov/24 está no snapshot Abr/26 E no Mai/26), os fichários precisam SEMPRE
  // filtrar por mes_pagamento pra evitar dupla contagem.
  //
  // Convenção atual: usar SEMPRE o snapshot MAIS RECENTE de cada origem.

  /**
   * Retorna o mês de pagamento (string 'YYYY-MM') do snapshot mais recente
   * disponível no banco, ou null se não houver dados.
   */
  obterSnapshotMaisRecente() {
    try {
      const r = window.Banco.queryUnica(`
        SELECT MAX(mes_pagamento) AS mp
        FROM linhas_qvis
        WHERE mes_pagamento IS NOT NULL AND mes_pagamento != ''
      `);
      return r?.mp || null;
    } catch (e) {
      return null;
    }
  },

  /**
   * Retorna o snapshot mais recente, separado por origem:
   * { CONVENIO: '2026-04' | null, PARTICULAR: '2026-04' | null }
   * Cada origem pode ter seu próprio snapshot mais recente.
   */
  obterSnapshotsMaisRecentes() {
    try {
      const rows = window.Banco.query(`
        SELECT origem, MAX(mes_pagamento) AS mp
        FROM linhas_qvis
        WHERE mes_pagamento IS NOT NULL AND mes_pagamento != ''
        GROUP BY origem
      `);
      const res = { CONVENIO: null, PARTICULAR: null };
      for (const r of rows) res[r.origem] = r.mp;
      return res;
    } catch (e) {
      return { CONVENIO: null, PARTICULAR: null };
    }
  },

  /**
   * Lista todos os snapshots disponíveis no banco em ordem desc.
   * Retorna: ['2026-05', '2026-04', '2026-03', ...]
   */
  listarSnapshots() {
    try {
      return window.Banco.query(`
        SELECT DISTINCT mes_pagamento
        FROM linhas_qvis
        WHERE mes_pagamento IS NOT NULL AND mes_pagamento != ''
        ORDER BY mes_pagamento DESC
      `).map(r => r.mes_pagamento);
    } catch (e) {
      return [];
    }
  },

  // ─────────────────────────────────────────────────────────────────────
  // MODO DE EXIBIÇÃO — 3 estados, persistidos em localStorage:
  //   'tudo'   → mostra tudo (padrão)
  //   'oculto' → oculta todos os valores marcados com [data-ocultavel]
  //   'foco'   → modo apresentação: SÓ o médico em foco aparece com nome
  //              e valores reais; demais ficam com nome ofuscado ("Médico A",
  //              "Médico B"...) e valores [data-mascarar] ocultos.
  //
  // A API antiga `valoresOcultos()` / `toggleValoresOcultos()` é mantida
  // como wrapper para retrocompat dos fichários ainda não migrados.
  // ─────────────────────────────────────────────────────────────────────
  modoExibicao() {
    try {
      const m = localStorage.getItem('modo_exibicao');
      if (m === 'tudo' || m === 'oculto' || m === 'foco') return m;
      // Retrocompat: se ainda tiver a flag antiga, deriva
      if (localStorage.getItem('valores_ocultos') === '1') return 'oculto';
      return 'tudo';
    } catch (e) { return 'tudo'; }
  },
  setModoExibicao(modo, medicoNorm) {
    try {
      if (!['tudo', 'oculto', 'foco'].includes(modo)) modo = 'tudo';
      localStorage.setItem('modo_exibicao', modo);
      // mantém flag antiga em sincronia para qualquer código legado
      localStorage.setItem('valores_ocultos', modo === 'oculto' ? '1' : '0');
      if (modo === 'foco' && medicoNorm) {
        localStorage.setItem('foco_medico_norm', medicoNorm);
      } else if (modo !== 'foco') {
        localStorage.removeItem('foco_medico_norm');
      }
    } catch (e) {}
  },
  medicoFoco() {
    try { return localStorage.getItem('foco_medico_norm') || null; }
    catch (e) { return null; }
  },
  // Retrocompat: telas que ainda usam a API antiga continuam funcionando.
  valoresOcultos() {
    return this.modoExibicao() === 'oculto';
  },
  toggleValoresOcultos() {
    const m = this.modoExibicao();
    this.setModoExibicao(m === 'oculto' ? 'tudo' : 'oculto');
    return this.modoExibicao() === 'oculto';
  },
  // Aplica classe `.valor-oculto` em [data-ocultavel] (modo 'oculto') e em
  // [data-mascarar] (modo 'foco'). Chame em renderizar() após pintar a tela.
  aplicarMascaraValores() {
    const modo = this.modoExibicao();
    const ocultarTodos = (modo === 'oculto');
    const ocultarMascarados = (modo === 'foco');
    document.querySelectorAll('[data-ocultavel]').forEach(el => {
      el.classList.toggle('valor-oculto', ocultarTodos);
    });
    document.querySelectorAll('[data-mascarar]').forEach(el => {
      el.classList.toggle('valor-oculto', ocultarMascarados);
    });
  },

  // ─────────────────────────────────────────────────────────────────────
  // Formatar data ISO/timestamp → dd/mm/yyyy
  // Aceita: '2026-04-15', '2026-04-15 14:30:00', '2026-04-15T14:30:00'
  // ─────────────────────────────────────────────────────────────────────
  formatarDataBR(d) {
    if (!d) return '—';
    const s = String(d);
    // Tenta pegar só a parte da data (yyyy-mm-dd)
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    return s;  // formato inesperado: devolve cru
  },

  // ─────────────────────────────────────────────────────────────────────
  // Modal genérico de seleção de competência (Mês + Ano).
  // Retorna Promise<string|null> no formato 'AAAA-MM', ou null se cancelou.
  //
  //   const comp = await Utilidades.modalCompetencia({
  //     nomeArquivo: file.name,
  //     titulo: 'Informe a competência',
  //     aviso: 'Reimportar substitui os dados anteriores.',
  //   });
  // ─────────────────────────────────────────────────────────────────────
  modalCompetencia(opcoes = {}) {
    const {
      nomeArquivo = '',
      titulo = '📅 Informe a competência do relatório',
      aviso = 'Reimportar a mesma competência <strong>substitui</strong> os dados anteriores (não duplica).',
    } = opcoes;

    return new Promise((resolve) => {
      // Sugere o mês anterior do ano atual como padrão
      const hoje = new Date();
      const mesAnt = hoje.getMonth();             // 0..11 → mês JS
      const sugMes = String(mesAnt === 0 ? 12 : mesAnt).padStart(2, '0');
      const sugAno = String(mesAnt === 0 ? hoje.getFullYear() - 1 : hoje.getFullYear());

      const meses = [
        ['01','Janeiro'], ['02','Fevereiro'], ['03','Março'], ['04','Abril'],
        ['05','Maio'], ['06','Junho'], ['07','Julho'], ['08','Agosto'],
        ['09','Setembro'], ['10','Outubro'], ['11','Novembro'], ['12','Dezembro'],
      ];
      const anoBase = hoje.getFullYear();
      const anos = [];
      for (let a = anoBase + 1; a >= anoBase - 4; a--) anos.push(String(a));

      const esc = (s) => String(s ?? '').replace(/[<>]/g, '');

      const overlay = document.createElement('div');
      overlay.className = 'modal-comp-overlay';
      overlay.innerHTML = `
        <div class="modal-comp">
          <div class="modal-comp-header">
            <h3>${esc(titulo)}</h3>
            <button class="modal-comp-close" data-close>×</button>
          </div>
          <div class="modal-comp-body">
            ${nomeArquivo ? `
              <div class="modal-comp-info">
                <div class="modal-comp-linha">
                  <span class="modal-comp-lbl">Arquivo:</span>
                  <strong style="font-size: 11px">${esc(nomeArquivo)}</strong>
                </div>
              </div>
            ` : ''}

            <div class="modal-comp-grade">
              <div class="modal-comp-campo">
                <label>Mês *</label>
                <select id="modal-comp-mes" class="modal-comp-input">
                  ${meses.map(([v, l]) => `
                    <option value="${v}" ${v === sugMes ? 'selected' : ''}>${l}</option>
                  `).join('')}
                </select>
              </div>
              <div class="modal-comp-campo">
                <label>Ano *</label>
                <select id="modal-comp-ano" class="modal-comp-input">
                  ${anos.map(a => `
                    <option value="${a}" ${a === sugAno ? 'selected' : ''}>${a}</option>
                  `).join('')}
                </select>
              </div>
            </div>

            ${aviso ? `<div class="modal-comp-aviso">ℹ ${aviso}</div>` : ''}
          </div>
          <div class="modal-comp-footer">
            <button class="btn btn-pequeno" data-close>Cancelar</button>
            <button class="btn btn-primary" id="modal-comp-ok">✓ Continuar</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const mesInp = overlay.querySelector('#modal-comp-mes');
      const anoInp = overlay.querySelector('#modal-comp-ano');
      const btnOk = overlay.querySelector('#modal-comp-ok');

      setTimeout(() => mesInp && mesInp.focus(), 50);

      const finalizar = (v) => { overlay.remove(); resolve(v); };

      overlay.querySelectorAll('[data-close]').forEach(b =>
        b.addEventListener('click', () => finalizar(null))
      );
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) finalizar(null);
      });
      const escListener = (ev) => {
        if (ev.key === 'Escape') {
          finalizar(null);
          document.removeEventListener('keydown', escListener);
        }
      };
      document.addEventListener('keydown', escListener);

      btnOk.addEventListener('click', () => {
        finalizar(`${anoInp.value}-${mesInp.value}`);
      });
    });
  },

  // ─────────────────────────────────────────────────────────────────────
  // Staggered animation — anima cada elemento individualmente com delay
  // incremental (ScrollReveal / GSAP style, mas em vanilla JS).
  //
  //   Utilidades.staggerEntrada('.lio-kpi, .lio-aba, .lio-painel');
  //   Utilidades.staggerEntrada('.lio-kpi', { delay: 80, duracao: 400 });
  //
  // Opções:
  //   delay         ms entre cada elemento (padrão 60)
  //   duracao       ms da transição de cada um (padrão 360)
  //   deslocamento  px de translateY inicial (padrão 12)
  //   inicial       ms de espera antes do primeiro (padrão 0)
  // ─────────────────────────────────────────────────────────────────────
  staggerEntrada(seletor, opcoes = {}) {
    const {
      delay        = 60,
      duracao      = 360,
      deslocamento = 12,
      inicial      = 0,
    } = opcoes;

    // Espera próximo frame pra garantir que os elementos já estão pintados
    requestAnimationFrame(() => {
      const elementos = document.querySelectorAll(seletor);
      const easing = 'cubic-bezier(0.4, 0, 0.2, 1)';

      elementos.forEach((el, i) => {
        // Estado inicial: invisível, deslocado pra baixo
        el.style.opacity = '0';
        el.style.transform = `translateY(${deslocamento}px)`;
        el.style.transition = 'none';
        el.style.willChange = 'opacity, transform';

        // Força reflow pra garantir que o estado inicial é aplicado antes da transição
        // eslint-disable-next-line no-unused-expressions
        el.offsetHeight;

        // Agenda a entrada
        setTimeout(() => {
          el.style.transition = `opacity ${duracao}ms ${easing}, transform ${duracao}ms ${easing}`;
          el.style.opacity = '1';
          el.style.transform = 'translateY(0)';

          // Limpa após terminar pra não deixar sujeira no style
          setTimeout(() => {
            el.style.willChange = '';
            el.style.transition = '';
            el.style.transform = '';
          }, duracao + 50);
        }, inicial + i * delay);
      });
    });
  },
};

// Exporta para uso global
window.Utilidades = Utilidades;

// V285: o perfil particular (VISÃO SAÚDE, PROJETO CATARATA...) agora aparece na coluna
// CONVÊNIO em TODOS os módulos — não vira mais sufixo no nome do procedimento.
// Mantida como passthrough pra não quebrar os call sites (Calcular/Auditoria).
Utilidades.procComPerfil = function (l) {
  if (!l) return '';
  return (l.procedimento != null ? String(l.procedimento) : '');
};

// V286: nome a exibir na coluna CONVÊNIO. Perfil particular (VISÃO SAÚDE, PROJETO
// CATARATA...) aparece aqui; senão o convênio normal (branco no particular).
Utilidades.convenioComPerfil = function (l) {
  if (l && l._regraPerfil && l._perfilNome) return String(l._perfilNome).trim();
  return (l && l.convenio) ? String(l.convenio) : '';
};

/**
 * ═══ V922: FILTRO MULTI — o padrão do Calcular Repasse para TODOS os módulos ═
 * Um valor de filtro passa a poder ser STRING (legado, 1 item) ou ARRAY
 * (multi). Semântica: vazio = todos; N itens = UNIÃO (a linha entra se casar
 * com qualquer um). Cada módulo usa estes helpers no estado, no painel
 * (checkbox + busca) e na aplicação do filtro — o visual continua o do módulo.
 */
// Funções livres (sem `this`): os métodos podem ser passados soltos como
// callback (ex.: `const rot = FM.rotulo`) sem perder o vínculo do objeto.
Utilidades.filtroMulti = (function () {
  /** normaliza string|array → array de strings não vazias */
  function sel(v) {
    if (Array.isArray(v)) return v.map(x => String(x)).filter(x => x.trim() !== '');
    const s = String(v == null ? '' : v).trim();
    return s ? [s] : [];
  }
  function ativo(v) { return sel(v).length > 0; }
  /** união por CONTÉM (o comportamento dos filtros de texto de sempre) */
  function casa(v, valor) {
    const s = sel(v);
    if (!s.length) return true;
    const alvo = String(valor == null ? '' : valor).toUpperCase();
    return s.some(x => alvo.includes(String(x).toUpperCase()));
  }
  /** união por IGUALDADE (para drops de valores fechados) */
  function casaExato(v, valor) {
    const s = sel(v);
    if (!s.length) return true;
    const alvo = String(valor == null ? '' : valor).toUpperCase().trim();
    return s.some(x => String(x).toUpperCase().trim() === alvo);
  }
  function toggle(v, item) {
    const s = sel(v).slice();
    const t = String(item);
    const i = s.indexOf(t);
    if (i >= 0) s.splice(i, 1); else s.push(t);
    return s;
  }
  function marcado(v, item) { return sel(v).includes(String(item)); }
  function rotulo(v, vazio) {
    const s = sel(v);
    if (!s.length) return vazio || 'Todos';
    if (s.length === 1) return s[0];
    return `${s.length} selecionados`;
  }
  /** WHERE de união por LIKE pra montar SQL — devolve a condição e empurra os params */
  function sqlLike(v, coluna, params) {
    const s = sel(v);
    if (!s.length) return null;
    const conds = s.map(x => { params.push('%' + String(x).toUpperCase() + '%'); return `UPPER(${coluna}) LIKE ?`; });
    return `(${conds.join(' OR ')})`;
  }
  return { sel, ativo, casa, casaExato, toggle, marcado, rotulo, sqlLike };
})();


// ============================================================================
// MARCA DO PROFISSIONAL INSTITUCIONAL (ATLAS v1.0)
//
// Nos relatórios do hospital, alguns papéis vêm no nome da PRÓPRIA instituição
// ("MEDICO CENTRO DIAGNOSTICOS CBV"): não é repasse de médico, e a Inspeção
// zera o valor na extração. A palavra que identifica a instituição é DADO do
// hospital atendido — não é marca da ferramenta —, por isso mora em
// config_sistema (MARCA_INSTITUCIONAL) e se edita na Administração. O padrão
// é 'CBV' porque é assim que os relatórios do CBV escrevem.
// ============================================================================
(function () {
  const CHAVE = 'MARCA_INSTITUCIONAL';
  const PADRAO = 'CBV';
  let _cache = null;

  function ler() {
    if (_cache) return _cache;
    let v = '';
    try {
      if (window.Banco && Banco.db && Banco.queryUnica) {
        const r = Banco.queryUnica(`SELECT valor FROM config_sistema WHERE chave = ?`, [CHAVE]);
        v = r && r.valor ? String(r.valor) : '';
      }
    } catch (_) { v = ''; }
    v = (window.Utilidades.normalizar ? Utilidades.normalizar(v) : String(v).toUpperCase()).trim();
    _cache = v || PADRAO;
    return _cache;
  }

  window.Utilidades.marcaInstitucional = ler;
  window.Utilidades.marcaInstitucionalGravar = function (valor) {
    const v = String(valor || '').trim().toUpperCase();
    if (!v) return;
    Banco.executar(`INSERT OR REPLACE INTO config_sistema (chave, valor) VALUES (?, ?)`, [CHAVE, v]);
    _cache = null;
    if (Banco.salvarDebounced) Banco.salvarDebounced();
  };
  /** O nome do profissional é a própria instituição? (palavra inteira, sem acento) */
  window.Utilidades.ehProfissionalInstitucional = function (nome) {
    const n = window.Utilidades.normalizar ? Utilidades.normalizar(nome) : String(nome || '').toUpperCase();
    const marca = ler().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('\\b' + marca + '\\b').test(n);
  };
})();
