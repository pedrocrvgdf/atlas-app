/**
 * ============================================================================
 * NÚCLEO DE REPASSE — App.repasse
 *
 * Sistema de "providers": cada fichário de Desempenho (LIO, OPME, Fracionamento,
 * etc.) registra COMO expõe seus repasses num formato PADRONIZADO. A tela
 * "Calcular Repasse" só consome e consolida — não conhece a lógica de cada um.
 *
 * Plugar um fichário novo = registrar um provider. Nada mais muda.
 *
 * ── Linha de repasse padronizada (o que cada provider entrega) ──────────────
 *   {
 *     fichario:          'LIO',           // origem (rótulo)
 *     ficharioId:        'lio',           // id do provider
 *     competencia:       '2026-04',
 *     admissao:          '39476901',
 *     paciente:          'FULANO DE TAL',
 *     produto:           'LIO CLAREON ...',
 *     convenio:          'BOMBEIROS (DF)',
 *     origem:            'Convênio' | 'Particular',
 *     executante:        'DR JOÃO',       // quem executou
 *     indicante:         'DR MARIA',      // quem indicou (pode ser = executante)
 *     repasseExecutante: 630.00,          // valor que o executante recebe
 *     repasseIndicante:  87.50,           // valor que o indicante recebe (0 se não há)
 *     valorBase:         3500.00,         // base do cálculo (Valor LIO, valor, etc.)
 *     _meta:             {...}            // qualquer extra do fichário (opcional)
 *   }
 * ============================================================================
 */
(function () {
  'use strict';
  window.App = window.App || {};

  const App = window.App;

  App.repasse = {
    /** Mapa de providers registrados: id → { id, nome, icone, calcular(filtros) } */
    providers: {},

    /**
     * Registra um provider de repasse.
     * @param {string} id       identificador único (ex: 'lio')
     * @param {object} provider { nome, icone?, calcular(filtros) → linhas[] }
     */
    registrar(id, provider) {
      if (!id || !provider || typeof provider.calcular !== 'function') {
        console.warn('[repasse] provider inválido:', id, provider);
        return;
      }
      this.providers[id] = Object.assign({ id, nome: id, icone: '∑' }, provider);
    },

    /** Lista os providers registrados (ordenados por nome). */
    listarProviders() {
      return Object.values(this.providers)
        .sort((a, b) => String(a.nome).localeCompare(String(b.nome)));
    },

    /**
     * Roda TODOS os providers e devolve um array único de linhas padronizadas.
     * @param {object} filtros { ano, mes, ficharios? }  — ficharios opcional: Set de ids
     */
    calcularTudo(filtros) {
      filtros = filtros || {};
      const linhas = [];
      for (const prov of this.listarProviders()) {
        if (filtros.ficharios && !filtros.ficharios.has(prov.id)) continue;
        try {
          const r = prov.calcular(filtros) || [];
          for (const l of r) {
            // normaliza e carimba a origem
            linhas.push(Object.assign({
              fichario: prov.nome,
              ficharioId: prov.id,
              competencia: '',
              admissao: '',
              paciente: '',
              produto: '',
              convenio: '',
              origem: '',
              executante: '',
              indicante: '',
              repasseExecutante: 0,
              repasseIndicante: 0,
              valorBase: 0,
            }, l, { fichario: prov.nome, ficharioId: prov.id }));
          }
        } catch (e) {
          console.error(`[repasse] provider "${prov.id}" falhou:`, e);
        }
      }
      return linhas;
    },

    /**
     * Consolida as linhas POR MÉDICO, separando o que ele recebe como
     * Executante e como Indicante (somando TODOS os fichários).
     *
     * @returns Map<nomeMedico, {
     *   medico, totalComoExecutante, totalComoIndicante, totalGeral,
     *   nAdmissoes, porFichario: Map<ficharioId, {nome, exec, ind, total}>,
     *   linhasExecutante[], linhasIndicante[]
     * }>
     */
    consolidarPorMedico(linhas) {
      const mapa = new Map();
      const norm = (s) => String(s || '').trim().toUpperCase();

      const garantir = (nome) => {
        const chave = norm(nome);
        if (!mapa.has(chave)) {
          mapa.set(chave, {
            medico: String(nome || '').trim(),
            totalComoExecutante: 0,
            totalComoIndicante: 0,
            totalGeral: 0,
            nAdmissoes: 0,
            _admissoes: new Set(),
            porFichario: new Map(),
            linhasExecutante: [],
            linhasIndicante: [],
          });
        }
        return mapa.get(chave);
      };

      const acumFichario = (reg, ficharioId, ficharioNome, papel, valor) => {
        if (!reg.porFichario.has(ficharioId)) {
          reg.porFichario.set(ficharioId, { nome: ficharioNome, exec: 0, ind: 0, total: 0 });
        }
        const pf = reg.porFichario.get(ficharioId);
        if (papel === 'exec') pf.exec += valor;
        else pf.ind += valor;
        pf.total += valor;
      };

      for (const l of linhas) {
        const exec = norm(l.executante);
        const ind = norm(l.indicante);
        const repExec = Number(l.repasseExecutante) || 0;
        const repInd = Number(l.repasseIndicante) || 0;

        // Executante recebe o repasse de executante
        if (exec && repExec > 0) {
          const reg = garantir(l.executante);
          reg.totalComoExecutante += repExec;
          reg.totalGeral += repExec;
          reg._admissoes.add(l.admissao);
          reg.linhasExecutante.push(l);
          acumFichario(reg, l.ficharioId, l.fichario, 'exec', repExec);
        }
        // Indicante recebe o repasse de indicante (quando há e é ≠ executante)
        if (ind && repInd > 0) {
          const reg = garantir(l.indicante);
          reg.totalComoIndicante += repInd;
          reg.totalGeral += repInd;
          reg._admissoes.add(l.admissao);
          reg.linhasIndicante.push(l);
          acumFichario(reg, l.ficharioId, l.fichario, 'ind', repInd);
        }
      }

      // finaliza contagem de admissões
      for (const reg of mapa.values()) {
        reg.nAdmissoes = reg._admissoes.size;
        delete reg._admissoes;
      }
      return mapa;
    },

    /** Lista de competências (YYYY-MM) disponíveis na Produção, mais recente primeiro. */
    listarCompetencias() {
      try {
        const rows = Banco.query(`
          SELECT DISTINCT competencia FROM linhas_producao
          WHERE competencia IS NOT NULL AND competencia <> ''
          ORDER BY competencia DESC
        `);
        return (rows || []).map(r => r.competencia).filter(Boolean);
      } catch (_) { return []; }
    },
  };
})();
