/**
 * ============================================================================
 * SESSÃO E SENHA ADMINISTRATIVA — ATLAS v1.0: SEM TELA DE LOGIN
 * ============================================================================
 *
 * A ferramenta roda 100% no navegador, com os dados só na máquina de quem a
 * abre: uma tela de login aqui nunca foi segurança de verdade (quem tem o
 * computador tem o IndexedDB). Por isso o ATLAS entra direto.
 *
 * O que fica é a SENHA ADMINISTRATIVA — uma trava de confirmação para as
 * ações que não têm volta (apagar tudo, publicar uma versão da Base Tabela,
 * desmarcar uma admissão paga no OPME). O hash SHA-256 dela fica em
 * localStorage (chave 'auth_config_v1'); a senha em texto puro nunca é
 * gravada. Padrão de fábrica: 1q2w3e4r5t6y7u — troque em Administração.
 *
 * A API antiga (estaLogado, podeAcessar, usuarioAtual, login, logout) continua
 * existindo para as telas que a chamam — todas respondem "liberado".
 */

const Auth = {

  CHAVE_CONFIG:  'auth_config_v1',
  CHAVE_SESSAO:  'auth_sessao_v1',
  USUARIO_PADRAO: 'ATLAS',
  SENHA_PADRAO:   '1q2w3e4r5t6y7u',

  // Módulos do sistema (devem bater com data-tela do menu lateral)
  MODULOS: [
    { id: 'dashboard',    nome: 'Visão Geral' },
    { id: 'base-tabela',  nome: 'Base Tabela' },
    { id: 'medicos',      nome: 'Médicos' },
    { id: 'unidades',     nome: 'Unidades' },
    { id: 'de-para-nomes', nome: 'De-Para de Nomes' },
    { id: 'desempenho-lio',              nome: 'Desempenho · LIO' },
    { id: 'desempenho-opme',             nome: 'Desempenho · OPME' },
    { id: 'desempenho-fellow',           nome: 'Desempenho · Fellow' },
    { id: 'desempenho-fracionamento',    nome: 'Desempenho · Fracionamento' },
    { id: 'desempenho-refractive-laser', nome: 'Desempenho · Refractive Laser' },
    { id: 'desempenho-periodos',         nome: 'Desempenho · Períodos' },
    { id: 'desempenho-cargos',           nome: 'Desempenho · Cargos Administrativos' },
    { id: 'desempenho-lentes-contato',   nome: 'Desempenho · Lentes de Contato' },
    { id: 'desempenho-luz-pulsada',      nome: 'Desempenho · Luz Pulsada' },
    { id: 'desempenho-estrabismo',       nome: 'Desempenho · Estrabismo' },
    { id: 'desempenho-laudos',           nome: 'Desempenho · Laudos' },
    { id: 'desempenho-crosslink',        nome: 'Desempenho · Crosslink' },
    { id: 'importar-qvis',       nome: 'Importar QVIS' },
    { id: 'importar-producao',   nome: 'Importar PRODUÇÃO' },
    { id: 'calcular',            nome: 'Calcular Repasse' },
    { id: 'pagamentos-externos', nome: 'Pagamentos Externos' },
    { id: 'auditoria',    nome: 'Auditoria' },
    { id: 'relatorios',   nome: 'Relatórios' },
    { id: 'producao-medica', nome: 'Produção Médica' },
    { id: 'backup',       nome: 'Backup' },
    { id: 'administracao', nome: 'Administração', somenteAdmin: true },
    { id: 'sistema',      nome: 'Sistema', somenteAdmin: true },
  ],

  // ==========================================================================
  // INICIALIZAÇÃO
  // ==========================================================================

  async inicializar() {
    let cfg = this._lerConfig();
    if (!cfg) {
      // Primeiro acesso: cria config padrão
      cfg = {
        usuario: this.USUARIO_PADRAO,
        senhaHash: await this._hash(this.SENHA_PADRAO),
        permissoes: this._permissoesPadrao(),
        criadoEm: new Date().toISOString(),
      };
      this._gravarConfig(cfg);
    } else {
      // instalações antigas (adm.atlas / adm.cbv) viram o usuário único ATLAS,
      // com a mesma senha administrativa
      if (cfg.usuario !== this.USUARIO_PADRAO) {
        cfg.usuario = this.USUARIO_PADRAO;
        this._gravarConfig(cfg);
      }
      if (!cfg.permissoes) {
        // Migração: adiciona permissões em config antiga
        cfg.permissoes = this._permissoesPadrao();
        this._gravarConfig(cfg);
      }
    }
  },

  _permissoesPadrao() {
    // Admin pode acessar todos os módulos
    const p = {};
    for (const m of this.MODULOS) p[m.id] = true;
    return p;
  },

  // ==========================================================================
  // SESSÃO
  // ==========================================================================

  /** ATLAS v1.0: não há login — a sessão começa quando a aba abre. */
  estaLogado() {
    if (!sessionStorage.getItem(this.CHAVE_SESSAO)) {
      sessionStorage.setItem(this.CHAVE_SESSAO, JSON.stringify({
        usuario: this.USUARIO_PADRAO,
        entrouEm: new Date().toISOString(),
      }));
    }
    return true;
  },

  /** Mantido pela API: sempre entra. */
  async login() {
    this.estaLogado();
    return true;
  },

  /** Mantido pela API: só zera o relógio da sessão. */
  logout() {
    sessionStorage.removeItem(this.CHAVE_SESSAO);
  },

  usuarioAtual() {
    return this.USUARIO_PADRAO;
  },

  // ==========================================================================
  // SENHA
  // ==========================================================================

  /** Verifica se a senha informada bate com a do administrador (sem mexer na sessão). */
  async verificarSenha(senha) {
    const cfg = this._lerConfig();
    if (!cfg) return false;
    try {
      return (await this._hash(senha)) === cfg.senhaHash;
    } catch (e) {
      return false;
    }
  },

  async alterarSenha(senhaAtual, novaSenha) {
    const cfg = this._lerConfig();
    if (!cfg) throw new Error('Configuração não encontrada');

    const hashAtual = await this._hash(senhaAtual);
    if (hashAtual !== cfg.senhaHash) {
      throw new Error('Senha atual incorreta');
    }
    if (!novaSenha || novaSenha.length < 6) {
      throw new Error('A nova senha deve ter pelo menos 6 caracteres');
    }

    cfg.senhaHash = await this._hash(novaSenha);
    cfg.senhaAlteradaEm = new Date().toISOString();
    this._gravarConfig(cfg);
  },

  // ==========================================================================
  // PERMISSÕES
  // ==========================================================================

  // V697: o sistema de PERMISSÕES POR MÓDULO foi desativado a pedido — todo
  // módulo fica sempre visível (uma ferramenta por unidade, um admin). As
  // funções ficam pela compatibilidade, mas ignoram qualquer permissão gravada
  // (módulo escondido por config antiga volta a aparecer sozinho).
  podeAcessar(modulo) {
    return true;
  },

  getPermissoes() {
    return this._permissoesPadrao();
  },

  setPermissao(modulo, permitido) { /* V697: sem efeito */ },

  // ==========================================================================
  // INTERNAL
  // ==========================================================================

  _lerConfig() {
    try {
      const raw = localStorage.getItem(this.CHAVE_CONFIG);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  _gravarConfig(cfg) {
    localStorage.setItem(this.CHAVE_CONFIG, JSON.stringify(cfg));
  },

  /** SHA-256 do texto, em hex. */
  async _hash(texto) {
    const enc = new TextEncoder().encode(texto);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  },
};

window.Auth = Auth;
