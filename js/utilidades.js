/**
 * ============================================================================
 * ATLAS — UTILIDADES GLOBAIS
 *
 * Helpers compartilhados por toda a ferramenta. Convenções da casa:
 *   - normalizar(): TODA comparação de texto (nomes, procedimentos, papéis)
 *     passa por aqui — acento, caixa e pontuação nunca decidem um match.
 *   - moeda()/formatarNumero(): exibição SEMPRE em pt-BR.
 *   - similaridade(): Levenshtein normalizado (0..1) para matching fuzzy.
 *   - aplicarFormatosExport(): convenção de exportação — dinheiro sai como
 *     "R$ 300,00" e percentual como "2,5%" VISUALMENTE, mas com o número
 *     real por baixo (dá para somar no Excel).
 * ============================================================================
 */
(function () {
  'use strict';

  // Namespace global da aplicação — criado AQUI (primeiro script) para que
  // as telas possam se registrar em App.telas antes de o app.js carregar.
  window.App = window.App || {};
  window.App.telas = window.App.telas || {};

  const Utilidades = {};

  // ──────────────────────────────────────────────────────────────────────
  // TEXTO
  // ──────────────────────────────────────────────────────────────────────

  /** Normalização canônica: sem acento, MAIÚSCULAS, só [A-Z0-9 ], espaços colapsados. */
  Utilidades.normalizar = function (s) {
    if (s == null) return '';
    return String(s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  /**
   * Código de admissão comparável (regra da metodologia ATLAS): só os
   * dígitos, sem zeros à esquerda — '0039476901' e '39476901' são a MESMA
   * admissão. Sem dígito nenhum, cai no texto sem espaços.
   */
  Utilidades.normAdm = function (x) {
    const s = String(x == null ? '' : x).trim().replace(/\.0+$/, '');
    const d = s.replace(/\D/g, '').replace(/^0+/, '');
    return d || s.replace(/\s/g, '');
  };

  /** Escapa HTML para interpolação segura em template strings. */
  Utilidades.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  };

  /** Distância de Levenshtein (iterativa, 2 linhas de memória). */
  function levenshtein(a, b) {
    if (a === b) return 0;
    const la = a.length, lb = b.length;
    if (!la) return lb;
    if (!lb) return la;
    let prev = new Array(lb + 1);
    let cur = new Array(lb + 1);
    for (let j = 0; j <= lb; j++) prev[j] = j;
    for (let i = 1; i <= la; i++) {
      cur[0] = i;
      const ca = a.charCodeAt(i - 1);
      for (let j = 1; j <= lb; j++) {
        const custo = (ca === b.charCodeAt(j - 1)) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + custo);
      }
      const t = prev; prev = cur; cur = t;
    }
    return prev[lb];
  }

  /** Similaridade 0..1 entre dois textos JÁ normalizados (1 = idênticos). */
  Utilidades.similaridade = function (a, b) {
    a = String(a || ''); b = String(b || '');
    if (!a.length && !b.length) return 1;
    const maior = Math.max(a.length, b.length);
    if (!maior) return 1;
    return 1 - levenshtein(a, b) / maior;
  };

  // ──────────────────────────────────────────────────────────────────────
  // NÚMEROS, MOEDA E DATAS
  // ──────────────────────────────────────────────────────────────────────

  Utilidades.formatarNumero = function (n, casas = 2) {
    return (Number(n) || 0).toLocaleString('pt-BR', {
      minimumFractionDigits: casas, maximumFractionDigits: casas,
    });
  };

  Utilidades.moeda = function (n) {
    return 'R$ ' + Utilidades.formatarNumero(n, 2);
  };

  /**
   * Converte texto de planilha em número. Aceita "1.234,56", "1234.56",
   * "R$ 300,00", número puro. Devolve 0 para vazio/inválido.
   */
  Utilidades.paraNumero = function (v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    let s = String(v).trim().replace(/[R$\s%]/g, '');
    if (!s) return 0;
    const temVirgula = s.includes(','), temPonto = s.includes('.');
    if (temVirgula && temPonto) {
      // o separador MAIS À DIREITA é o decimal
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (temVirgula) {
      s = s.replace(/\./g, '').replace(',', '.');
    }
    const n = parseFloat(s);
    return isFinite(n) ? n : 0;
  };

  /**
   * Converte célula de data (Date do SheetJS, serial Excel, "dd/mm/aaaa",
   * "aaaa-mm-dd") em ISO 'YYYY-MM-DD'. Devolve '' quando não reconhece.
   */
  Utilidades.paraDataISO = function (v) {
    if (v == null || v === '') return '';
    if (v instanceof Date && !isNaN(v)) {
      return v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') +
        '-' + String(v.getDate()).padStart(2, '0');
    }
    if (typeof v === 'number' && v > 20000 && v < 60000) {
      // serial Excel (dias desde 1900-01-00, com o bug do ano bissexto de 1900)
      const ms = Math.round((v - 25569) * 86400 * 1000);
      const d = new Date(ms);
      return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') +
        '-' + String(d.getUTCDate()).padStart(2, '0');
    }
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
    if (m) {
      let ano = m[3].length === 2 ? '20' + m[3] : m[3];
      return ano + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
    }
    return '';
  };

  /** 'YYYY-MM-DD' → 'YYYY-MM' (competência); '' quando não há data. */
  Utilidades.competenciaDe = function (dataISO) {
    const s = String(dataISO || '');
    return /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : '';
  };

  /** 'YYYY-MM' → 'mm/aaaa' para exibição. */
  Utilidades.compExibir = function (comp) {
    const m = String(comp || '').match(/^(\d{4})-(\d{2})$/);
    return m ? (m[2] + '/' + m[1]) : (comp || '—');
  };

  /** 'YYYY-MM-DD' → 'dd/mm/aaaa' para exibição. */
  Utilidades.dataExibir = function (iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? (m[3] + '/' + m[2] + '/' + m[1]) : (iso || '—');
  };

  // ──────────────────────────────────────────────────────────────────────
  // DOMÍNIO — fontes pagadoras e papéis
  // ──────────────────────────────────────────────────────────────────────

  /** Classifica texto livre em CONVENIO / PARTICULAR / SUS (padrão CONVENIO). */
  Utilidades.classificarFonte = function (texto) {
    const t = Utilidades.normalizar(texto);
    if (!t) return 'CONVENIO';
    if (t.includes('PARTICULAR') || t === 'PART') return 'PARTICULAR';
    if (t === 'SUS' || t.startsWith('SUS ') || t.endsWith(' SUS')) return 'SUS';
    return 'CONVENIO';
  };

  /**
   * Papéis canônicos da ferramenta. Todo papel de relatório resolve para um
   * destes via PAPEL_ALIASES (ou fica com a própria grafia normalizada).
   */
  Utilidades.PAPEIS = ['EXECUTANTE', 'AUXILIAR', 'INDICANTE', 'SOLICITANTE', 'LAUDO', 'ANESTESISTA'];

  const PAPEL_ALIASES = {
    'EXECUTANTE': 'EXECUTANTE', 'CIRURGIAO': 'EXECUTANTE', 'MEDICO EXECUTANTE': 'EXECUTANTE',
    'MEDICO': 'EXECUTANTE', 'PROFISSIONAL': 'EXECUTANTE', 'PROFISSIONAL EXECUTANTE': 'EXECUTANTE',
    'AUXILIAR': 'AUXILIAR', 'AUXILIAR 1': 'AUXILIAR', 'AUXILIAR 2': 'AUXILIAR',
    '1 AUXILIAR': 'AUXILIAR', '2 AUXILIAR': 'AUXILIAR', 'PRIMEIRO AUXILIAR': 'AUXILIAR',
    'AUXILIAR SADT': 'AUXILIAR', 'AUX': 'AUXILIAR',
    'INDICANTE': 'INDICANTE', 'MEDICO INDICANTE': 'INDICANTE', 'INDICADOR': 'INDICANTE',
    'SOLICITANTE': 'SOLICITANTE', 'MEDICO SOLICITANTE': 'SOLICITANTE',
    'LAUDO': 'LAUDO', 'MEDICO LAUDO': 'LAUDO', 'MEDICO DE LAUDO': 'LAUDO', 'LAUDANTE': 'LAUDO',
    'ANESTESISTA': 'ANESTESISTA', 'ANESTESIOLOGISTA': 'ANESTESISTA',
  };

  /** Papel de relatório → papel canônico ('' quando vazio). */
  Utilidades.papelCanonico = function (texto) {
    const t = Utilidades.normalizar(texto);
    if (!t) return '';
    return PAPEL_ALIASES[t] || t;
  };

  // ──────────────────────────────────────────────────────────────────────
  // UI — toast, loading e download
  // ──────────────────────────────────────────────────────────────────────

  let _toastTimer = null;
  /** Toast no canto inferior direito. tipo: 'ok' | 'erro' | 'aviso' | 'info' */
  Utilidades.toast = function (msg, tipo = 'info', ms = 3200) {
    let el = document.getElementById('atlas-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'atlas-toast';
      document.body.appendChild(el);
    }
    el.className = 'mostrar tipo-' + tipo;
    el.textContent = String(msg == null ? '' : msg);
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { el.className = ''; }, ms);
  };

  /** Overlay de trabalho longo. mostrar('Calculando…') / esconder(). */
  Utilidades.loading = {
    mostrar(msg) {
      let el = document.getElementById('atlas-loading');
      if (!el) {
        el = document.createElement('div');
        el.id = 'atlas-loading';
        el.innerHTML = '<div class="al-box"><img src="assets/globo_atlas_ouro.png" alt="" class="al-globo">' +
          '<div class="al-msg"></div></div>';
        document.body.appendChild(el);
      }
      el.querySelector('.al-msg').textContent = msg || 'Trabalhando…';
      el.classList.add('mostrar');
    },
    esconder() {
      const el = document.getElementById('atlas-loading');
      if (el) el.classList.remove('mostrar');
    },
  };

  /** Dispara download de bytes como arquivo. */
  Utilidades.baixarArquivo = function (nome, dados, mime) {
    const blob = dados instanceof Blob ? dados : new Blob([dados], { type: mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nome;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 800);
  };

  // ──────────────────────────────────────────────────────────────────────
  // EXPORT EXCEL — convenção da casa
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Aplica formato Contábil nas colunas indicadas de uma worksheet do SheetJS:
   * dinheiro exibe "R$ 1.234,56" e percentual "2,5%", mantendo o NÚMERO real
   * na célula (somável no Excel).
   *
   * @param {object} ws        worksheet (XLSX.utils.aoa_to_sheet)
   * @param {object} cols      { moeda: [índices 0-based], pct: [índices] }
   * @param {number} linhaIni  primeira linha de DADOS (0-based; pula cabeçalho)
   */
  Utilidades.aplicarFormatosExport = function (ws, cols, linhaIni = 1) {
    if (!ws || !ws['!ref'] || typeof XLSX === 'undefined') return ws;
    const range = XLSX.utils.decode_range(ws['!ref']);
    const moeda = new Set(cols && cols.moeda || []);
    const pct = new Set(cols && cols.pct || []);
    for (let R = Math.max(linhaIni, range.s.r); R <= range.e.r; R++) {
      for (let C = range.s.c; C <= range.e.c; C++) {
        if (!moeda.has(C) && !pct.has(C)) continue;
        const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
        if (!cell || typeof cell.v !== 'number') continue;
        cell.t = 'n';
        cell.z = moeda.has(C) ? '"R$" #,##0.00' : '0.0#"%"';
      }
    }
    return ws;
  };

  /** Exporta AOA (array de arrays) como .xlsx com formatos da casa. */
  Utilidades.exportarXLSX = function (nomeArquivo, abas) {
    if (typeof XLSX === 'undefined') {
      Utilidades.toast('Biblioteca de planilha ainda carregando — tente de novo em 2s.', 'aviso');
      return;
    }
    const wb = XLSX.utils.book_new();
    for (const aba of abas) {
      const ws = XLSX.utils.aoa_to_sheet(aba.linhas);
      if (aba.larguras) ws['!cols'] = aba.larguras.map(w => ({ wch: w }));
      Utilidades.aplicarFormatosExport(ws, aba.formatos || {}, aba.linhaIni != null ? aba.linhaIni : 1);
      XLSX.utils.book_append_sheet(wb, ws, aba.nome.slice(0, 31));
    }
    const bytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    Utilidades.baixarArquivo(nomeArquivo, bytes,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  };

  window.Utilidades = Utilidades;
})();
