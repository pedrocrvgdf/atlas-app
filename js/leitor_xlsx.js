/**
 * ============================================================================
 * ATLAS — LEITOR DE .XLSX EM STREAMING (arquivos pesados)
 *
 * O SheetJS monta um objeto por célula: um relatório de 150 mil linhas × 47
 * colunas leva ~50 s e ~3 GB de memória só para ser LIDO, com a tela travada
 * o tempo todo. Um .xlsx é um zip com XML dentro; este leitor descompacta a
 * aba com o DecompressionStream (nativo do navegador) e varre o XML em
 * pedaços, entregando as linhas EM LOTES a quem importa — a planilha inteira
 * nunca fica na memória e a tela segue livre entre um lote e outro. É o que
 * os sistemas grandes fazem com arquivo pesado: processar em fluxo.
 *
 * Cobre o que a ATLAS precisa: texto (strings compartilhadas e inline, rich
 * text), número, data/hora (pelo estilo da célula, como o SheetJS com
 * cellDates), booleano e o valor calculado de fórmulas. Sem zip64 (arquivos
 * > 4 GB) nem zip com senha — nesses casos, e em qualquer erro, o Importador
 * cai no SheetJS (mesmo resultado, só mais lento).
 * ============================================================================
 */
(function () {
  'use strict';

  const SIG_EOCD = 0x06054b50, SIG_CEN = 0x02014b50, SIG_LOC = 0x04034b50;
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

  function suportado() {
    return typeof DecompressionStream !== 'undefined' && typeof TextDecoderStream !== 'undefined' &&
      typeof Blob !== 'undefined' && typeof Blob.prototype.stream === 'function';
  }

  /** Começa com a assinatura de zip (PK)? .xlsx/.xlsm sim; .xls binário e .csv não. */
  async function ehXlsx(file) {
    if (!file || file.size < 22) return false;
    const b = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    return b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4;
  }

  // ── texto XML ──────────────────────────────────────────────────────────
  function decodificar(s) {
    if (s.indexOf('&') >= 0) {
      s = s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (m, e) => {
        if (e.charCodeAt(0) === 35) {
          const cp = e.charCodeAt(1) === 120 ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
          return isFinite(cp) ? String.fromCodePoint(cp) : m;
        }
        return ENT[e] !== undefined ? ENT[e] : m;
      });
    }
    // escape do Excel para caracteres de controle ("_x000D_" = \r)
    if (s.indexOf('_x') >= 0) s = s.replace(/_x([0-9A-Fa-f]{4})_/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
    return s;
  }

  function atributo(attrs, nome) {
    const m = new RegExp('(?:^|\\s)' + nome + '="([^"]*)"').exec(attrs);
    return m ? m[1] : null;
  }

  /** Prefixo de namespace da raiz ('x:' em <x:worksheet>, '' no comum). */
  function prefixoDe(xml, raiz) {
    const m = new RegExp('<(?:([A-Za-z0-9_]+):)?' + raiz + '\\b').exec(xml);
    return m && m[1] ? m[1] + ':' : '';
  }

  /** 'AB' (de 'AB12') → 27. */
  function colunaIdx(ref) {
    let n = 0;
    for (let i = 0; i < ref.length; i++) {
      const c = ref.charCodeAt(i);
      if (c >= 65 && c <= 90) n = n * 26 + (c - 64);
      else if (c >= 97 && c <= 122) n = n * 26 + (c - 96);
      else break;
    }
    return n - 1;
  }

  // ── zip ────────────────────────────────────────────────────────────────
  async function bytes(file, ini, fim) {
    return new Uint8Array(await file.slice(ini, fim).arrayBuffer());
  }

  async function lerCentral(file) {
    const tam = file.size;
    const cauda = await bytes(file, Math.max(0, tam - 65557 - 22), tam);
    const dv = new DataView(cauda.buffer, cauda.byteOffset, cauda.byteLength);
    let pos = -1;
    for (let i = cauda.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === SIG_EOCD) { pos = i; break; }
    if (pos < 0) throw new Error('não é um zip válido');
    const n = dv.getUint16(pos + 10, true), tamCen = dv.getUint32(pos + 12, true), offCen = dv.getUint32(pos + 16, true);
    if (n === 0xffff || tamCen === 0xffffffff || offCen === 0xffffffff) throw new Error('zip64 não suportado');
    const cen = await bytes(file, offCen, offCen + tamCen);
    const cdv = new DataView(cen.buffer, cen.byteOffset, cen.byteLength);
    const dec = new TextDecoder('utf-8');
    const entradas = new Map();
    for (let p = 0, k = 0; k < n && p + 46 <= cen.length; k++) {
      if (cdv.getUint32(p, true) !== SIG_CEN) break;
      const flags = cdv.getUint16(p + 8, true), metodo = cdv.getUint16(p + 10, true);
      const csize = cdv.getUint32(p + 20, true), usize = cdv.getUint32(p + 24, true);
      const nLen = cdv.getUint16(p + 28, true), eLen = cdv.getUint16(p + 30, true), cLen = cdv.getUint16(p + 32, true);
      const off = cdv.getUint32(p + 42, true);
      const nome = dec.decode(cen.subarray(p + 46, p + 46 + nLen));
      entradas.set(nome, { nome, metodo, csize, usize, off, cifrado: !!(flags & 1) });
      p += 46 + nLen + eLen + cLen;
    }
    return entradas;
  }

  /** Fluxo de TEXTO (UTF-8) de uma entrada do zip, descompactado sob demanda. */
  async function fluxo(file, e) {
    if (e.cifrado) throw new Error('zip protegido por senha');
    const loc = await bytes(file, e.off, e.off + 30);
    const dv = new DataView(loc.buffer, loc.byteOffset, loc.byteLength);
    if (dv.getUint32(0, true) !== SIG_LOC) throw new Error('cabeçalho local inválido');
    const ini = e.off + 30 + dv.getUint16(26, true) + dv.getUint16(28, true);
    let s = file.slice(ini, ini + e.csize).stream();
    if (e.metodo === 8) s = s.pipeThrough(new DecompressionStream('deflate-raw'));
    else if (e.metodo !== 0) throw new Error('compressão não suportada: ' + e.metodo);
    return s.pipeThrough(new TextDecoderStream('utf-8'));
  }

  /** Percorre o texto de uma entrada em pedaços; cb devolve false para parar cedo. */
  async function percorrer(file, e, cb) {
    const reader = (await fluxo(file, e)).getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if ((await cb(value)) === false) { try { await reader.cancel(); } catch (_) { /* fluxo já fechado */ } break; }
      }
    } finally { try { reader.releaseLock(); } catch (_) { /* nada */ } }
  }

  async function texto(file, e) {
    if (!e) return '';
    let out = '';
    await percorrer(file, e, (p) => { out += p; });
    return out;
  }

  // ── partes da planilha ────────────────────────────────────────────────

  /** xl/sharedStrings.xml → array de textos (rich text concatenado, fonética fora). */
  async function lerStrings(file, e) {
    const out = [];
    if (!e) return out;
    let resto = '', reSi = null, reT = null, reRph = null;
    await percorrer(file, e, (pedaco) => {
      const buf = resto + pedaco;
      if (!reSi) {
        const m = /<(?:([A-Za-z0-9_]+):)?sst\b/.exec(buf);
        if (!m) { resto = buf; return; }
        const pref = m[1] ? m[1] + ':' : '';
        reSi = new RegExp('<' + pref + 'si\\b[^>]*?(?:/>|>([\\s\\S]*?)</' + pref + 'si>)', 'g');
        reT = new RegExp('<' + pref + 't\\b[^>]*?(?:/>|>([\\s\\S]*?)</' + pref + 't>)', 'g');
        reRph = new RegExp('<' + pref + 'rPh\\b[\\s\\S]*?</' + pref + 'rPh>', 'g');
      }
      let ultimo = 0, m;
      reSi.lastIndex = 0;
      while ((m = reSi.exec(buf)) !== null) {
        ultimo = reSi.lastIndex;
        let inner = m[1] || '';
        if (inner.indexOf('rPh') >= 0) inner = inner.replace(reRph, '');
        let s = '', t;
        reT.lastIndex = 0;
        while ((t = reT.exec(inner)) !== null) s += t[1] || '';
        out.push(decodificar(s));
      }
      resto = buf.slice(ultimo);
    });
    return out;
  }

  /** Formato embutido ou personalizado é de data/hora? (mesma regra do SheetJS) */
  function ehFormatoData(id, code) {
    if (code == null) {
      return (id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 45 && id <= 47) || (id >= 50 && id <= 58);
    }
    const limpo = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
    if (!limpo || /general/i.test(limpo)) return false;
    return /[ymdhs]/i.test(limpo);
  }

  /** xl/styles.xml → conjunto dos índices de estilo (atributo s da célula) que são data. */
  function estilosData(xml) {
    const datas = new Set();
    if (!xml) return datas;
    const pref = prefixoDe(xml, 'styleSheet');
    const fmts = new Map();
    const reFmt = new RegExp('<' + pref + 'numFmt\\b([^>]*?)/?>', 'g');
    let m;
    while ((m = reFmt.exec(xml)) !== null) {
      const id = atributo(m[1], 'numFmtId');
      if (id != null) fmts.set(Number(id), decodificar(atributo(m[1], 'formatCode') || ''));
    }
    const ini = xml.search(new RegExp('<' + pref + 'cellXfs\\b'));
    if (ini < 0) return datas;
    const fim = xml.indexOf('</' + pref + 'cellXfs>', ini);
    const bloco = xml.slice(ini, fim < 0 ? undefined : fim);
    const reXf = new RegExp('<' + pref + 'xf\\b([^>]*?)/?>', 'g');
    let idx = 0;
    while ((m = reXf.exec(bloco)) !== null) {
      const id = Number(atributo(m[1], 'numFmtId') || 0);
      if (ehFormatoData(id, fmts.get(id))) datas.add(idx);
      idx++;
    }
    return datas;
  }

  /**
   * Lê uma aba em fluxo. opts: { aoLote(linhas, info), porLote, limite }.
   * Linhas em branco não entram (como sheet_to_json com blankrows:false);
   * célula sem valor vira ''. Devolve { lidas, total } (total = última linha
   * declarada em <dimension>, quando há — serve para a barra de progresso).
   */
  async function lerAba(file, e, ss, datas, date1904, opts) {
    if (!e) throw new Error('aba não encontrada no arquivo');
    const porLote = opts.porLote || 4000, limite = opts.limite || 0;
    const aoLote = opts.aoLote || (() => {});
    const b = date1904 ? new Date(1904, 0, 1, 0, 0, 0) : new Date(1899, 11, 30, 0, 0, 0);
    const baseMs = b.getTime() + (new Date().getTimezoneOffset() - b.getTimezoneOffset()) * 60000;
    const paraData = (v) => new Date(baseMs + Math.round(v * 86400000));

    let pref = null, tRow, tRowFim, tC, tCFim, tV, tVFim, reT;
    let resto = '', lote = [], lidas = 0, total = null, parar = false;
    const info = () => ({ lidas, total, pct: total ? Math.min(0.99, lidas / total) : null });

    const lerLinha = (s) => {
      const cells = [];
      let col = -1, vazia = true, p = 0;
      for (;;) {
        const i = s.indexOf(tC, p);
        if (i < 0) break;
        const cc = s.charCodeAt(i + tC.length);
        if (cc !== 32 && cc !== 62 && cc !== 47) { p = i + tC.length; continue; }
        const fimTag = s.indexOf('>', i);
        if (fimTag < 0) break;
        const auto = s.charCodeAt(fimTag - 1) === 47;
        const attrs = s.slice(i + tC.length, auto ? fimTag - 1 : fimTag);
        const ri = attrs.indexOf(' r="');
        if (ri >= 0) col = colunaIdx(attrs.slice(ri + 4, attrs.indexOf('"', ri + 4))); else col++;
        if (auto) { p = fimTag + 1; continue; }
        const fim = s.indexOf(tCFim, fimTag);
        if (fim < 0) break;
        const inner = s.slice(fimTag + 1, fim);
        p = fim + tCFim.length;
        const ti = attrs.indexOf(' t="');
        const t = ti >= 0 ? attrs.slice(ti + 4, attrs.indexOf('"', ti + 4)) : '';
        let v;
        if (t === 'inlineStr') {
          let txt = '', m;
          reT.lastIndex = 0;
          while ((m = reT.exec(inner)) !== null) txt += m[1] || '';
          v = decodificar(txt);
        } else {
          const vi = inner.indexOf(tV);
          if (vi < 0) continue;
          const vTag = inner.indexOf('>', vi);
          if (vTag < 0 || inner.charCodeAt(vTag - 1) === 47) continue;
          const vFim = inner.indexOf(tVFim, vTag);
          if (vFim < 0) continue;
          const raw = inner.slice(vTag + 1, vFim);
          if (t === 's') { const x = ss[Number(raw)]; v = x == null ? '' : x; }
          else if (t === 'str' || t === 'e') v = decodificar(raw);
          else if (t === 'b') v = raw === '1' || raw === 'true';
          else if (t === 'd') { const d = new Date(raw); v = isNaN(d) ? decodificar(raw) : d; }
          else {
            const num = Number(raw);
            if (!isFinite(num)) v = decodificar(raw);
            else {
              const si = attrs.indexOf(' s="');
              const estilo = si >= 0 ? Number(attrs.slice(si + 4, attrs.indexOf('"', si + 4))) : 0;
              v = datas.has(estilo) ? paraData(num) : num;
            }
          }
        }
        if (col < 0) col = 0;
        while (cells.length < col) cells.push('');
        cells[col] = v;
        vazia = false;   // célula COM valor (mesmo texto vazio) conta como linha presente — igual ao SheetJS
      }
      return vazia ? null : cells;
    };

    const consumir = async (buf) => {
      let p = 0, ultimo = 0;
      for (;;) {
        const i = buf.indexOf(tRow, p);
        if (i < 0) break;
        const cc = buf.charCodeAt(i + tRow.length);
        if (cc !== 32 && cc !== 62 && cc !== 47) { p = i + tRow.length; continue; }
        const fimTag = buf.indexOf('>', i);
        if (fimTag < 0) break;                                   // tag partida: espera o próximo pedaço
        if (buf.charCodeAt(fimTag - 1) === 47) { p = fimTag + 1; ultimo = p; continue; }   // <row/> vazia
        const fim = buf.indexOf(tRowFim, fimTag);
        if (fim < 0) break;                                      // linha partida: espera o próximo pedaço
        const linha = lerLinha(buf.slice(fimTag + 1, fim));
        p = fim + tRowFim.length; ultimo = p;
        if (linha) {
          lote.push(linha); lidas++;
          if (lote.length >= porLote) { const l = lote; lote = []; await aoLote(l, info()); }
          if (limite && lidas >= limite) { parar = true; break; }
        }
      }
      return ultimo;
    };

    await percorrer(file, e, async (pedaco) => {
      let buf = resto + pedaco;
      if (pref === null) {
        const m = /<(?:([A-Za-z0-9_]+):)?worksheet\b/.exec(buf);
        if (!m) { resto = buf; return; }
        pref = m[1] ? m[1] + ':' : '';
        tRow = '<' + pref + 'row'; tRowFim = '</' + pref + 'row>';
        tC = '<' + pref + 'c'; tCFim = '</' + pref + 'c>';
        tV = '<' + pref + 'v'; tVFim = '</' + pref + 'v>';
        reT = new RegExp('<' + pref + 't\\b[^>]*?(?:/>|>([\\s\\S]*?)</' + pref + 't>)', 'g');
        const d = new RegExp('<' + pref + 'dimension\\b[^>]*?ref="[A-Z]+\\d+(?::[A-Z]+(\\d+))?"').exec(buf);
        if (d && d[1]) total = Number(d[1]);
      }
      const ultimo = await consumir(buf);
      if (parar) return false;
      resto = ultimo ? buf.slice(ultimo) : buf;
    });
    if (lote.length) { const l = lote; lote = []; await aoLote(l, info()); }
    return { lidas, total };
  }

  /**
   * Abre o .xlsx: lista as abas e prepara strings/estilos. Devolve
   *   { abas: [{nome, caminho}], date1904, lerAba(caminho, opts), cabeca(caminho, n) }
   */
  async function abrir(file) {
    const entradas = await lerCentral(file);
    const wb = entradas.get('xl/workbook.xml');
    if (!wb) throw new Error('não é uma planilha .xlsx (sem xl/workbook.xml)');
    const wbXml = await texto(file, wb);
    const relsXml = await texto(file, entradas.get('xl/_rels/workbook.xml.rels'));
    const date1904 = /date1904="(1|true)"/i.test(wbXml);
    const rels = new Map();
    const reRel = /<Relationship\b([^>]*?)\/?>/g;
    let m;
    while ((m = reRel.exec(relsXml)) !== null) {
      const id = atributo(m[1], 'Id'), alvo = atributo(m[1], 'Target');
      if (id && alvo) rels.set(id, decodificar(alvo));
    }
    const abas = [];
    const pref = prefixoDe(wbXml, 'workbook');
    const reSheet = new RegExp('<' + pref + 'sheet\\b([^>]*?)/?>', 'g');
    while ((m = reSheet.exec(wbXml)) !== null) {
      const rid = /(?:^|\s)[\w.]+:id="([^"]*)"/.exec(m[1]);
      const alvo = rid ? rels.get(rid[1]) : null;
      if (!alvo) continue;
      const caminho = alvo.startsWith('/') ? alvo.slice(1) : 'xl/' + alvo.replace(/^\.\//, '');
      if (entradas.has(caminho)) abas.push({ nome: decodificar(atributo(m[1], 'name') || ''), caminho });
    }
    if (!abas.length) throw new Error('planilha sem abas');
    const datas = estilosData(await texto(file, entradas.get('xl/styles.xml')));
    const ss = await lerStrings(file, entradas.get('xl/sharedStrings.xml'));
    return {
      abas, date1904, strings: ss.length,
      lerAba: (caminho, opts) => lerAba(file, entradas.get(caminho), ss, datas, date1904, opts || {}),
      cabeca: async (caminho, n) => {
        const linhas = [];
        const r = await lerAba(file, entradas.get(caminho), ss, datas, date1904,
          { limite: n, porLote: n, aoLote: (l) => { for (const x of l) linhas.push(x); } });
        return { linhas, total: r.total };
      },
    };
  }

  window.LeitorXlsx = { suportado, ehXlsx, abrir, decodificar, colunaIdx, ehFormatoData };
})();
