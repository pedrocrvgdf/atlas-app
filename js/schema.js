/**
 * ============================================================================
 * SCHEMA DO BANCO SQLITE — Todas as tabelas do app
 * ============================================================================
 * Mesma estrutura definida originalmente (20 tabelas), agora em SQLite-no-navegador
 * usando sql.js. As tabelas suportam todas as fases do projeto.
 */

const SCHEMA_SQL = `
-- ===================================================================
-- BLOCO 1: CADASTROS BÁSICOS
-- ===================================================================

CREATE TABLE IF NOT EXISTS pm_valores_adicionais (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  competencia TEXT NOT NULL,
  beneficiario TEXT NOT NULL,
  descricao TEXT,
  valor REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS convenios (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  nome            TEXT NOT NULL UNIQUE,
  ativo           INTEGER NOT NULL DEFAULT 1,
  criado_em       TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS papeis (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  nome            TEXT NOT NULL UNIQUE,
  descricao       TEXT
);

CREATE TABLE IF NOT EXISTS mapeamento_papeis (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  papel_qvis      TEXT NOT NULL UNIQUE,
  papel_id        INTEGER NOT NULL,
  FOREIGN KEY (papel_id) REFERENCES papeis(id)
);

CREATE TABLE IF NOT EXISTS procedimentos (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  nome_oficial    TEXT NOT NULL UNIQUE,
  nome_normalizado TEXT NOT NULL,
  classificacao   TEXT,
  repassavel      INTEGER NOT NULL DEFAULT 1,
  observacoes     TEXT,
  nomenclatura    TEXT,
  criado_em       TEXT DEFAULT CURRENT_TIMESTAMP,
  atualizado_em   TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_proc_normalizado ON procedimentos(nome_normalizado);

CREATE TABLE IF NOT EXISTS sinonimos_proc (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  procedimento_id INTEGER NOT NULL,
  grafia          TEXT NOT NULL UNIQUE,
  grafia_normalizada TEXT NOT NULL,
  fonte           TEXT,
  aprovado_por    TEXT,
  criado_em       TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (procedimento_id) REFERENCES procedimentos(id)
);
CREATE INDEX IF NOT EXISTS idx_sin_grafia_norm ON sinonimos_proc(grafia_normalizada);
-- V596: contagem de grafias por procedimento (grade da Base Tabela)
CREATE INDEX IF NOT EXISTS idx_sin_proc ON sinonimos_proc(procedimento_id);

CREATE TABLE IF NOT EXISTS tabela_repasse (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  procedimento_id INTEGER NOT NULL,
  papel_id        INTEGER NOT NULL,
  fonte_pagadora  TEXT NOT NULL,
  valor           REAL,
  percentual      REAL,
  ativo           INTEGER NOT NULL DEFAULT 1,
  criado_em       TEXT DEFAULT CURRENT_TIMESTAMP,
  atualizado_em   TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (procedimento_id) REFERENCES procedimentos(id),
  FOREIGN KEY (papel_id) REFERENCES papeis(id),
  UNIQUE (procedimento_id, papel_id, fonte_pagadora)
);
-- V596: join regras×procedimento/fonte da grade da Base Tabela
CREATE INDEX IF NOT EXISTS idx_trep_proc_fonte ON tabela_repasse(procedimento_id, fonte_pagadora);

CREATE TABLE IF NOT EXISTS medicos (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  nome_oficial    TEXT NOT NULL UNIQUE,
  nome_normalizado TEXT NOT NULL,
  crm             TEXT,
  rqe             TEXT,
  especialidade   TEXT,
  cnpj            TEXT,
  razao_social    TEXT,
  email           TEXT,
  telefone        TEXT,
  tipo_vinculo    TEXT,
  cargo_admin     TEXT,
  ativo           INTEGER NOT NULL DEFAULT 1,
  observacoes     TEXT,
  codigo_atlas    TEXT,
  clinica_externa_id INTEGER,     -- V699: clínica do médico externo (externos_clinicas)
  criado_em       TEXT DEFAULT CURRENT_TIMESTAMP,
  atualizado_em   TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_med_normalizado ON medicos(nome_normalizado);

CREATE TABLE IF NOT EXISTS sinonimos_medico (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  medico_id       INTEGER NOT NULL,
  grafia          TEXT NOT NULL UNIQUE,
  grafia_normalizada TEXT NOT NULL,
  confianca       REAL,
  aprovado_por    TEXT,
  criado_em       TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (medico_id) REFERENCES medicos(id)
);

-- Catálogo de especialidades médicas (Catarata, Retina, etc.)
CREATE TABLE IF NOT EXISTS especialidades (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  nome            TEXT NOT NULL UNIQUE,
  ordem           INTEGER NOT NULL DEFAULT 0,
  ativo           INTEGER NOT NULL DEFAULT 1,
  criado_em       TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Relação muitos-para-muitos: médicos × especialidades
CREATE TABLE IF NOT EXISTS medico_especialidades (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  medico_id       INTEGER NOT NULL,
  especialidade_id INTEGER NOT NULL,
  criado_em       TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (medico_id) REFERENCES medicos(id) ON DELETE CASCADE,
  FOREIGN KEY (especialidade_id) REFERENCES especialidades(id) ON DELETE CASCADE,
  UNIQUE (medico_id, especialidade_id)
);
CREATE INDEX IF NOT EXISTS idx_me_medico ON medico_especialidades(medico_id);
CREATE INDEX IF NOT EXISTS idx_me_especialidade ON medico_especialidades(especialidade_id);

CREATE TABLE IF NOT EXISTS unidades (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  nome            TEXT NOT NULL UNIQUE,
  ordem           INTEGER NOT NULL DEFAULT 0,
  ativo           INTEGER NOT NULL DEFAULT 1,
  criado_em       TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Relação muitos-para-muitos: médicos × unidades
CREATE TABLE IF NOT EXISTS medico_unidades (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  medico_id       INTEGER NOT NULL,
  unidade_id      INTEGER NOT NULL,
  criado_em       TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (medico_id) REFERENCES medicos(id) ON DELETE CASCADE,
  FOREIGN KEY (unidade_id) REFERENCES unidades(id) ON DELETE CASCADE,
  UNIQUE (medico_id, unidade_id)
);
CREATE INDEX IF NOT EXISTS idx_mu_medico ON medico_unidades(medico_id);
CREATE INDEX IF NOT EXISTS idx_mu_unidade ON medico_unidades(unidade_id);

-- Relação muitos-para-muitos: médicos × cargos administrativos
-- (DIRETOR_MEDICO, COORDENADOR_MEDICO, RESPONSAVEL_TECNICO)
-- Usamos texto direto em vez de tabela de cargos porque os 3 valores são fixos
-- e estão no catálogo do código (Utilidades.CARGOS_ADMIN).
CREATE TABLE IF NOT EXISTS medico_cargos (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  medico_id       INTEGER NOT NULL,
  cargo           TEXT NOT NULL,
  criado_em       TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (medico_id) REFERENCES medicos(id) ON DELETE CASCADE,
  UNIQUE (medico_id, cargo)
);
CREATE INDEX IF NOT EXISTS idx_mc_medico ON medico_cargos(medico_id);
CREATE INDEX IF NOT EXISTS idx_mc_cargo  ON medico_cargos(cargo);

CREATE TABLE IF NOT EXISTS regras_especiais (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  medico_id       INTEGER,
  procedimento_id INTEGER,
  papel_id        INTEGER,
  fonte_pagadora  TEXT,
  convenio_id     INTEGER,
  tipo_calculo    TEXT NOT NULL,
  valor           REAL,
  percentual      REAL,
  descricao       TEXT NOT NULL,
  ativa           INTEGER NOT NULL DEFAULT 1,
  valida_de       TEXT,
  valida_ate      TEXT,
  criado_em       TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (medico_id) REFERENCES medicos(id),
  FOREIGN KEY (procedimento_id) REFERENCES procedimentos(id),
  FOREIGN KEY (papel_id) REFERENCES papeis(id),
  FOREIGN KEY (convenio_id) REFERENCES convenios(id)
);

-- ===================================================================
-- BLOCO 2: PAGAMENTOS EXTERNOS
-- ===================================================================

-- Valor mensal fixo por TAG de cargo administrativo (DM, CM, RT).
-- 1 registro por cargo. Quem está com a TAG recebe o valor automaticamente.
CREATE TABLE IF NOT EXISTS valores_cargos (
  cargo           TEXT PRIMARY KEY,
  valor_mensal    REAL NOT NULL DEFAULT 0,
  atualizado_em   TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Exceções: casos especiais onde um médico ocupa um cargo mas a regra de
-- pagamento é diferente do valor fixo da TAG (ex: Coordenador de Lentes,
-- que recebe % sobre produção em vez de valor fixo).
CREATE TABLE IF NOT EXISTS excecoes_cargo (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  nome            TEXT NOT NULL,           -- ex: "Coordenador de Lentes de Contato"
  cargo_base      TEXT NOT NULL,           -- DM/CM/RT (qual TAG a exceção sobrescreve)
  medico_id       INTEGER NOT NULL,        -- médico que ocupa essa função
  tipo_calculo    TEXT NOT NULL DEFAULT 'PERCENTUAL_PROCEDIMENTOS',
                                            -- PERCENTUAL_PROCEDIMENTOS | VALOR_FIXO
  percentual      REAL NOT NULL DEFAULT 0, -- usado se tipo = PERCENTUAL_PROCEDIMENTOS
  valor_fixo      REAL NOT NULL DEFAULT 0, -- usado se tipo = VALOR_FIXO
  ativo           INTEGER NOT NULL DEFAULT 1,
  criado_em       TEXT DEFAULT CURRENT_TIMESTAMP,
  atualizado_em   TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (medico_id) REFERENCES medicos(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_exc_medico ON excecoes_cargo(medico_id);

-- Procedimentos elegíveis para cada exceção (quais procedimentos contam)
CREATE TABLE IF NOT EXISTS excecao_procedimentos (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  excecao_id      INTEGER NOT NULL,
  procedimento_id INTEGER NOT NULL,
  FOREIGN KEY (excecao_id) REFERENCES excecoes_cargo(id) ON DELETE CASCADE,
  FOREIGN KEY (procedimento_id) REFERENCES procedimentos(id) ON DELETE CASCADE,
  UNIQUE (excecao_id, procedimento_id)
);
CREATE INDEX IF NOT EXISTS idx_excp_excecao ON excecao_procedimentos(excecao_id);

-- ====================================================================
-- LENTES DE CONTATO (fichário do módulo Desempenho)
-- ====================================================================
-- Configuração centralizada das % de repasse para lentes de contato.
-- Tabela com 1 linha por chave (key/value) — valores numéricos.
CREATE TABLE IF NOT EXISTS config_lentes_contato (
  chave         TEXT PRIMARY KEY,
  valor         REAL NOT NULL DEFAULT 0,
  atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Configuração de TEXTOS customizados (nomes de coluna que o usuário pode
-- renomear no painel de Ajustes). Separada da config numérica acima porque
-- 'valor' lá é REAL e aqui é TEXT.
CREATE TABLE IF NOT EXISTS config_textos_lentes_contato (
  chave         TEXT PRIMARY KEY,
  valor         TEXT,
  atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Procedimentos elegíveis para Lentes de Contato.
-- Importado de planilha Excel (sem reaproveitar a tabela 'procedimentos',
-- que é da Base Tabela, pois o set de LC é diferente e independente).
CREATE TABLE IF NOT EXISTS procedimentos_lentes (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  nome              TEXT NOT NULL UNIQUE,
  nome_normalizado  TEXT NOT NULL,
  ativo             INTEGER NOT NULL DEFAULT 1,
  criado_em         TEXT DEFAULT CURRENT_TIMESTAMP,
  atualizado_em     TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_proc_lentes_norm ON procedimentos_lentes(nome_normalizado);
CREATE INDEX IF NOT EXISTS idx_proc_lentes_ativo ON procedimentos_lentes(ativo);

-- ====================================================================
-- ESTRABISMO (fichário do módulo Desempenho)
-- ====================================================================
-- Repasse fixo por cirurgia:
--   * QTD = 1 (unilateral)   → R$ 1.260 (convênio)  /  R$ 300 (SUS)
--   * QTD = 2 (bilateral)    → R$ 1.680 (convênio)  /  R$ 300 (SUS)
-- Valores são editáveis no painel ⚙ Ajustes da tela.
CREATE TABLE IF NOT EXISTS config_estrabismo (
  chave         TEXT PRIMARY KEY,
  valor         REAL NOT NULL DEFAULT 0,
  atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO config_estrabismo (chave, valor) VALUES
  ('VALOR_QTD1_CONVENIO', 1260),
  ('VALOR_QTD2_CONVENIO', 1680),
  ('VALOR_QTD1_SUS',       300),
  ('VALOR_QTD2_SUS',       300);

-- Marcações de quantidade (1 ou 2) POR ADMISSÃO.
-- Uma admissão pode ter várias linhas de produto contendo "ESTRABISMO" (ex:
-- CICLO VERTICAL + HORIZONTAL MONOCULAR), mas representa 1 cirurgia. O
-- usuário marca uma única vez (uni ou bilateral) e isso vale para toda a
-- admissão.
CREATE TABLE IF NOT EXISTS marcacoes_estrabismo (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  cod_admissao    TEXT NOT NULL,
  competencia     TEXT NOT NULL,
  quantidade      INTEGER NOT NULL DEFAULT 1,  -- 1 ou 2
  atualizado_em   TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (cod_admissao, competencia)
);
CREATE INDEX IF NOT EXISTS idx_marc_estrab_adm  ON marcacoes_estrabismo(cod_admissao);
CREATE INDEX IF NOT EXISTS idx_marc_estrab_comp ON marcacoes_estrabismo(competencia);

-- ====================================================================
-- LINHAS QVIS (relatório oficial: Convênio + Particular)
-- ====================================================================
-- Cada linha do relatório QVIS detalha um procedimento × profissional × papel.
-- Estrutura espelha as 33 colunas do arquivo original.
-- A coluna 'origem' identifica de qual relatório veio (CONVENIO/PARTICULAR).
CREATE TABLE IF NOT EXISTS linhas_qvis (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  origem                   TEXT NOT NULL,            -- 'CONVENIO' ou 'PARTICULAR'
  competencia              TEXT NOT NULL,            -- 'YYYY-MM' (derivada da DATA ADMISSAO)
  nome_profissional        TEXT,
  nome_normalizado         TEXT,                     -- UPPER+TRIM pra busca
  papel                    TEXT,                     -- MEDICO/SOLICITANTE/CIRURGIAO/MEDICO DE LAUDO/INDICANTE/AUXILIAR 1/2
  procedimento             TEXT,
  procedimento_normalizado TEXT,                     -- UPPER+TRIM pra busca
  quantidade               INTEGER DEFAULT 1,
  convenio                 TEXT,
  unidade_faturamento      TEXT,
  unidade_atendimento      TEXT,
  destino                  TEXT,
  estado                   TEXT,
  admissao                 TEXT,
  data_admissao            TEXT,
  paciente                 TEXT,
  cod_paciente             TEXT,
  conta                    TEXT,
  envio                    TEXT,
  produzido                REAL DEFAULT 0,
  honorario                REAL DEFAULT 0,
  recebido                 REAL DEFAULT 0,
  repassado                REAL DEFAULT 0,
  tipo_paciente            TEXT,
  especialidade            TEXT,
  tipo_recebimento         TEXT,                     -- CONVÊNIO/PARTICULAR
  classificacao_produto    TEXT,                     -- EXAME/CONSULTA/PROCEDIMENTO/OPME/TAXA/MATERIAL/MEDICAMENTO/GÁS/DIÁRIA
  cod_unidade_faturamento  TEXT,
  cod_repasse              TEXT,
  cod_regra_repasse        TEXT,
  novo_valor               REAL,
  mes_pagamento            TEXT,                     -- 'YYYY-MM' (mês de pagamento, definido na importação)
  criado_em                TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_qvis_competencia    ON linhas_qvis(competencia);
CREATE INDEX IF NOT EXISTS idx_qvis_admissao       ON linhas_qvis(admissao);
CREATE INDEX IF NOT EXISTS idx_qvis_proc_norm      ON linhas_qvis(procedimento_normalizado);
CREATE INDEX IF NOT EXISTS idx_qvis_papel          ON linhas_qvis(papel);
CREATE INDEX IF NOT EXISTS idx_qvis_nome_norm      ON linhas_qvis(nome_normalizado);
CREATE INDEX IF NOT EXISTS idx_qvis_origem         ON linhas_qvis(origem);
CREATE INDEX IF NOT EXISTS idx_qvis_mes_pgto       ON linhas_qvis(mes_pagamento);

-- ====================================================================
-- LUZ PULSADA (fichário do módulo Desempenho)
-- ====================================================================
-- Conceito: TAXA SOBRE PROCEDIMENTOS — não é cargo administrativo nem
-- repasse por execução. É um aluguel/uso de equipamento privado do médico.
-- O aparelho de Luz Pulsada pertence à Dra. Fabíola Gavioli e o hospital
-- paga a ela X% sobre toda a produção realizada com o aparelho.
CREATE TABLE IF NOT EXISTS config_luz_pulsada (
  chave         TEXT PRIMARY KEY,
  valor         TEXT NOT NULL,
  atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO config_luz_pulsada (chave, valor) VALUES
  ('PERCENTUAL_TAXA',        '8.00'),               -- % cobrada pela proprietária do equipamento
  ('PROPRIETARIO_MEDICO_ID', ''),                   -- ID do médico em medicos.id (a proprietária — vazio até user definir)
  ('BASE_PARTICULAR',        '1'),                  -- '1' ou '0' — inclui PRODUZIDO do particular?
  ('BASE_CONVENIO',          '1');                  -- '1' ou '0' — inclui RECEBIDO do convênio?

-- ====================================================================
-- CROSSLINK (fichário do módulo Desempenho)
-- ====================================================================
-- Conceito: TAXA SOBRE PROCEDIMENTOS (idêntico à Luz Pulsada, porém:
--   - Filtro: PROCEDIMENTO LIKE '%CROSSLINK%'
--   - Tipo de taxa: VALOR FIXO por procedimento (não percentual)
-- A máquina de Crosslink pertence à Dra. Maria Regina Catai Chalita.
-- Padrão: R$ 288,00 por procedimento realizado (editável).
CREATE TABLE IF NOT EXISTS config_crosslink (
  chave         TEXT PRIMARY KEY,
  valor         TEXT NOT NULL,
  atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO config_crosslink (chave, valor) VALUES
  ('VALOR_FIXO',             '288.00'),             -- R$ pagos por procedimento de Crosslink
  ('PROPRIETARIO_MEDICO_ID', ''),                   -- ID da proprietária (auto: Maria Regina Catai)
  ('BASE_PARTICULAR',        '1'),
  ('BASE_CONVENIO',          '1');

-- ====================================================================
-- REFRACTIVE LASER (fichário do módulo Desempenho)
-- ====================================================================
-- Conceito: TAXA SOBRE PROCEDIMENTOS (aluguel/uso do aparelho)
--   Proprietária: Dra. Maria Regina Catai Chalita
--   7 procedimentos elegíveis (A-G), cada um com valor próprio.
--   Exames (A,B) = valor fixo por linha (ignora QTD)
--   Cirúrgicos (C-G):
--     - Convênio: valor fixo × QTD_efetiva (mono=1 / bi=2)
--     - Particular: percentual sobre PRODUZIDO
--   QTD efetiva: se nome contém "BINOCULAR" → 2; senão usa coluna QUANTIDADE
CREATE TABLE IF NOT EXISTS config_refractive_laser (
  chave         TEXT PRIMARY KEY,
  valor         TEXT NOT NULL,
  atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO config_refractive_laser (chave, valor) VALUES
  ('PROPRIETARIO_MEDICO_ID', ''),
  ('BASE_PARTICULAR',        '1'),
  ('BASE_CONVENIO',          '1'),
  -- Valores de exames (A, B) — fixos por linha
  ('VAL_A_CONV',  '28.72'),
  ('VAL_A_PART', '62.50'),
  ('VAL_B_CONV', '23.40'),
  ('VAL_B_PART', '62.50'),
  -- Valores cirúrgicos (C-G) — valor fixo por QTD efetiva no convênio
  ('VAL_CIRUR_CONV_QTD1', '254.65'),
  ('VAL_CIRUR_CONV_QTD2', '509.30'),
  -- Particular cirúrgico — percentual sobre PRODUZIDO
  ('PCT_CIRUR_PART',      '26.50');


CREATE TABLE IF NOT EXISTS tipos_pagamento_externo (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo          TEXT NOT NULL UNIQUE,
  nome            TEXT NOT NULL,
  descricao       TEXT,
  ativo           INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS cargos_fixos (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  medico_id       INTEGER NOT NULL,
  cargo           TEXT NOT NULL,
  unidade_id      INTEGER,
  valor_mensal    REAL NOT NULL,
  ativo           INTEGER NOT NULL DEFAULT 1,
  valido_de       TEXT,
  valido_ate      TEXT,
  criado_em       TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (medico_id) REFERENCES medicos(id),
  FOREIGN KEY (unidade_id) REFERENCES unidades(id)
);

CREATE TABLE IF NOT EXISTS valores_periodo_medico (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  medico_id       INTEGER NOT NULL,
  unidade_id      INTEGER NOT NULL,
  valor_periodo   REAL NOT NULL,
  valido_de       TEXT,
  valido_ate      TEXT,
  criado_em       TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (medico_id) REFERENCES medicos(id),
  FOREIGN KEY (unidade_id) REFERENCES unidades(id)
);

CREATE TABLE IF NOT EXISTS regras_fracionamento (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  medicamento     TEXT,
  aplicacao       TEXT NOT NULL,
  valor           REAL NOT NULL,
  descricao       TEXT,
  ativo           INTEGER NOT NULL DEFAULT 1
);

-- ===================================================================
-- BLOCO 3: PROCESSAMENTOS MENSAIS
-- ===================================================================

CREATE TABLE IF NOT EXISTS competencias (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ano             INTEGER NOT NULL,
  mes             INTEGER NOT NULL,
  descricao       TEXT,
  fechada         INTEGER NOT NULL DEFAULT 0,
  criada_em       TEXT DEFAULT CURRENT_TIMESTAMP,
  fechada_em      TEXT,
  UNIQUE (ano, mes)
);

CREATE TABLE IF NOT EXISTS importacoes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  competencia_id  INTEGER NOT NULL,
  tipo            TEXT NOT NULL,
  nome_arquivo    TEXT NOT NULL,
  qtd_linhas      INTEGER,
  qtd_processadas INTEGER,
  qtd_erros       INTEGER,
  status          TEXT NOT NULL DEFAULT 'PENDENTE',
  importado_em    TEXT DEFAULT CURRENT_TIMESTAMP,
  importado_por   TEXT,
  log             TEXT,
  FOREIGN KEY (competencia_id) REFERENCES competencias(id)
);

-- ====================================================================
-- Linhas do relatório de PRODUÇÃO ANALÍTICA do hospital
-- ====================================================================
-- Esta é a fonte de apoio (não-oficial) usada pelos módulos de
-- desempenho (Lentes de Contato, OPME, LIO, etc.) — diferente do QVIS,
-- que é a fonte oficial do repasse financeiro.
-- Linhas com status 'DIRETO NA RECEPÇÃO' são descartadas na importação.
-- Linhas com 'Tipo Recebimento = CORTESIA' já vêm pré-filtradas do Excel.
CREATE TABLE IF NOT EXISTS linhas_producao (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  competencia           TEXT NOT NULL,     -- AAAA-MM (ex: 2026-04)
  importacao_id         INTEGER,

  -- Identificação
  cod_admissao          TEXT,
  data_admissao         TEXT,
  hora_admissao         TEXT,
  status_admissao       TEXT,

  -- Local e classificação
  unidade               TEXT,
  especialidade         TEXT,
  tipo_recebimento      TEXT,              -- CONVÊNIO/PARTICULAR/SUS
  destino               TEXT,
  classificacao_produto TEXT,              -- EXAME/CONSULTA/MATERIAL/MEDICAMENTO/PROCEDIMENTO/TAXA/OPME/GÁS/DIÁRIA
  tipo_produto          TEXT,
  categoria             TEXT,              -- Cirurgias/Exames/Consultas/Laser/Lentes de Contato/Outros
  subcategoria          TEXT,
  subespecialidade      TEXT,
  medico_externo        TEXT,

  -- Procedimento
  cod_apresentacao      TEXT,
  procedimento_principal TEXT,
  produto               TEXT,
  pacote                TEXT,

  -- Faturamento
  convenio              TEXT,
  plano                 TEXT,
  perfil_particular     TEXT,
  perfil_admissao       TEXT,
  carater_admissao      TEXT,
  observacao_admissao   TEXT,
  sala                  TEXT,
  profissional_admissao TEXT,

  -- Paciente
  tipo_paciente         TEXT,
  cod_paciente          TEXT,
  paciente              TEXT,
  data_nascimento       TEXT,
  idade_atendimento     INTEGER,
  faixa_etaria          TEXT,
  cid_alta              TEXT,
  descricao_cid         TEXT,

  -- Valores
  quantidade            REAL,
  valor                 REAL,

  -- Profissionais (13 papéis)
  indicante             TEXT,
  solicitante           TEXT,
  consultor             TEXT,
  medico                TEXT,
  cirurgiao             TEXT,
  instrumentador        TEXT,
  contatologa           TEXT,
  ortoptista            TEXT,
  auxiliar_sadt         TEXT,
  auxiliar_1            TEXT,
  auxiliar_2            TEXT,

  -- Controle
  linha_origem          INTEGER,
  importada_em          TEXT DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (importacao_id) REFERENCES importacoes(id)
);
CREATE INDEX IF NOT EXISTS idx_prod_competencia ON linhas_producao(competencia);
CREATE INDEX IF NOT EXISTS idx_prod_admissao    ON linhas_producao(cod_admissao);
CREATE INDEX IF NOT EXISTS idx_prod_categoria   ON linhas_producao(categoria);
CREATE INDEX IF NOT EXISTS idx_prod_tipo_rec    ON linhas_producao(tipo_recebimento);
CREATE INDEX IF NOT EXISTS idx_prod_class_prod  ON linhas_producao(classificacao_produto);
CREATE INDEX IF NOT EXISTS idx_prod_medico      ON linhas_producao(medico);
CREATE INDEX IF NOT EXISTS idx_prod_cirurgiao   ON linhas_producao(cirurgiao);

CREATE TABLE IF NOT EXISTS linhas_calculadas (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  linha_qvis_id   INTEGER NOT NULL,
  competencia_id  INTEGER NOT NULL,
  medico_id       INTEGER,
  procedimento_id INTEGER,
  papel_id        INTEGER,
  nome_profissional_original TEXT,
  valor_repasse   REAL NOT NULL DEFAULT 0,
  metodo_calculo  TEXT,
  regra_aplicada  TEXT,
  regra_especial_id INTEGER,
  flags           TEXT,
  excluida        INTEGER NOT NULL DEFAULT 0,
  motivo_exclusao TEXT,
  calculada_em    TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (linha_qvis_id) REFERENCES linhas_qvis(id),
  FOREIGN KEY (competencia_id) REFERENCES competencias(id),
  FOREIGN KEY (medico_id) REFERENCES medicos(id),
  FOREIGN KEY (procedimento_id) REFERENCES procedimentos(id),
  FOREIGN KEY (papel_id) REFERENCES papeis(id),
  FOREIGN KEY (regra_especial_id) REFERENCES regras_especiais(id)
);
CREATE INDEX IF NOT EXISTS idx_calc_competencia ON linhas_calculadas(competencia_id);
CREATE INDEX IF NOT EXISTS idx_calc_medico ON linhas_calculadas(medico_id);

CREATE TABLE IF NOT EXISTS lancamentos_externos (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  competencia_id  INTEGER NOT NULL,
  medico_id       INTEGER NOT NULL,
  tipo_pagamento_id INTEGER NOT NULL,
  descricao       TEXT NOT NULL,
  quantidade      REAL,
  valor_unitario  REAL,
  valor_total     REAL NOT NULL,
  referencia      TEXT,
  observacoes     TEXT,
  criado_em       TEXT DEFAULT CURRENT_TIMESTAMP,
  criado_por      TEXT,
  FOREIGN KEY (competencia_id) REFERENCES competencias(id),
  FOREIGN KEY (medico_id) REFERENCES medicos(id),
  FOREIGN KEY (tipo_pagamento_id) REFERENCES tipos_pagamento_externo(id)
);

-- ===================================================================
-- BLOCO 4: PERÍODOS POR UNIDADE
-- ===================================================================
-- Importação mensal da planilha "Repasse Médico - Períodos".
-- Linhas: 1 por (médico × unidade × mês). Snapshot por mês.

CREATE TABLE IF NOT EXISTS periodos_config (
  chave           TEXT PRIMARY KEY,
  valor           TEXT NOT NULL,
  atualizado_em   TEXT DEFAULT CURRENT_TIMESTAMP
);

-- V943: configuração da INSPEÇÃO DA ADMISSÃO (viaja no .db — V858; o módulo
-- voltou sem cofre). Chaves insp_* (pauta importada, vigias, recortes).
CREATE TABLE IF NOT EXISTS config_inspecao (
  chave           TEXT PRIMARY KEY,
  valor           TEXT,
  atualizado_em   TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ATLAS v1.3: RELATÓRIO FINAL — o relatório que o MÉDICO recebeu (um arquivo
-- por médico × mês de pagamento), importado pela aba "Relatório final" da
-- Inspeção. É a régua do que foi PAGO: a auditoria confronta o que a
-- ferramenta calcula (Relatórios) com estas linhas e diz o que falta pagar.
-- Regras de leitura: nunca deduplica, linha negativa é estorno e conta,
-- GLOSA vale zero (glosa = 1), competência = mês do pagamento.
CREATE TABLE IF NOT EXISTS relatorio_final (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  medico          TEXT NOT NULL,            -- nome oficial (de-para) ou como veio
  medico_norm     TEXT NOT NULL,
  competencia     TEXT NOT NULL,            -- 'YYYY-MM' (mês do pagamento — o mês em que o SISTEMA pagou as admissões)
  competencia_arquivo TEXT,                 -- ATLAS v1.3.1: o mês que o ARQUIVO dizia (pode diferir)
  layout          TEXT,                     -- 'ferramenta' | 'manual2' | 'manual1'
  arquivo         TEXT,
  periodo_ini     TEXT,                     -- "Pagamentos liberados entre … e …"
  periodo_fim     TEXT,
  n_linhas        INTEGER NOT NULL DEFAULT 0,
  total           REAL NOT NULL DEFAULT 0,  -- soma das linhas (glosa fora, estorno dentro)
  importado_em    TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_rf_med_comp ON relatorio_final(medico_norm, competencia);

CREATE TABLE IF NOT EXISTS relatorio_final_linhas (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  relatorio_id    INTEGER NOT NULL,
  competencia     TEXT,
  medico          TEXT,
  medico_norm     TEXT,
  admissao        TEXT,
  admissao_norm   TEXT,
  data            TEXT,                     -- ISO 'YYYY-MM-DD'
  paciente        TEXT,
  paciente_norm   TEXT,
  papel           TEXT,
  papel_canon     TEXT,
  procedimento    TEXT,
  procedimento_norm TEXT,
  valor           REAL NOT NULL DEFAULT 0,
  status          TEXT,
  modulo          TEXT,
  origem          TEXT,
  convenio        TEXT,
  glosa           INTEGER NOT NULL DEFAULT 0,
  linha_origem    INTEGER,
  FOREIGN KEY (relatorio_id) REFERENCES relatorio_final(id)
);
CREATE INDEX IF NOT EXISTS idx_rfl_rel  ON relatorio_final_linhas(relatorio_id);
CREATE INDEX IF NOT EXISTS idx_rfl_adm  ON relatorio_final_linhas(admissao_norm);
CREATE INDEX IF NOT EXISTS idx_rfl_med  ON relatorio_final_linhas(medico_norm, competencia);

-- V938: Ajuste Unidades — o que o médico do Períodos recebe além do plantão.
-- Só o que DIFERE do padrão (Consultas × Convênio fora da Matriz não paga) é gravado.
CREATE TABLE IF NOT EXISTS unidades_regras (
  unidade         TEXT NOT NULL,      -- chave da unidade (nome normalizado; '__OUTRAS__' = sem cadastro)
  proc            TEXT NOT NULL,      -- procedimento (nome normalizado da Base Tabela)
  fonte           TEXT NOT NULL,      -- CONVENIO | PARTICULAR | SUS
  paga            INTEGER NOT NULL DEFAULT 1,
  atualizado_em   TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (unidade, proc, fonte)
);
CREATE TABLE IF NOT EXISTS unidades_proc_categoria (
  proc            TEXT PRIMARY KEY,   -- procedimento sem categoria → categoria escolhida na tela
  categoria       TEXT NOT NULL,
  atualizado_em   TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS periodos_cadastro_valor (
  -- Valores especiais por médico (sobrescreve o padrão).
  -- A unidade é opcional: NULL = vale pra todas as unidades do médico.
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  nome_normalizado TEXT NOT NULL,
  nome_original   TEXT NOT NULL,
  unidade         TEXT,
  valor_periodo   REAL NOT NULL,
  observacao      TEXT,
  atualizado_em   TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(nome_normalizado, unidade)
);

CREATE TABLE IF NOT EXISTS periodos_linhas (
  -- Cada linha = 1 médico em 1 unidade num mês.
  -- (mes_ref + nome_normalizado + unidade) é a chave natural.
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  mes_ref         TEXT NOT NULL,
  nome_original   TEXT NOT NULL,
  nome_normalizado TEXT NOT NULL,
  unidade         TEXT NOT NULL,
  unidade_id      INTEGER,
  valor_periodo   REAL NOT NULL,
  sem1            INTEGER NOT NULL DEFAULT 0,
  sem2            INTEGER NOT NULL DEFAULT 0,
  sem3            INTEGER NOT NULL DEFAULT 0,
  sem4            INTEGER NOT NULL DEFAULT 0,
  sem5            INTEGER NOT NULL DEFAULT 0,
  total_periodos  INTEGER NOT NULL DEFAULT 0,
  total_valor     REAL NOT NULL DEFAULT 0,
  origem          TEXT,
  importado_em    TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(mes_ref, nome_normalizado, unidade),
  FOREIGN KEY (unidade_id) REFERENCES unidades(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_periodos_mes ON periodos_linhas(mes_ref);
CREATE INDEX IF NOT EXISTS idx_periodos_nome_norm ON periodos_linhas(nome_normalizado);
CREATE INDEX IF NOT EXISTS idx_periodos_unidade ON periodos_linhas(unidade);

-- ===================================================================
-- BLOCO 5: FELLOW (PLANTÕES DIÁRIOS)
-- ===================================================================
-- Importação mensal da planilha "Repasse Médico - Fellow".
-- Granularidade: 1 linha = 1 plantão (data + fellow + turno).
-- Mesmo fellow pode ter Manhã + Tarde + Noturno no mesmo dia.
-- Complemento NEGATIVO é preservado (fellow atendeu > meta) para controle.

CREATE TABLE IF NOT EXISTS fellow_config (
  chave           TEXT PRIMARY KEY,
  valor           TEXT NOT NULL,
  atualizado_em   TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fellow_cadastro (
  -- Lista de fellows. Auto-populada na importação (igual a unidades em Períodos).
  -- medico_id é OPCIONAL: fellow pode ser residente/estudante sem cadastro em medicos.
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  nome_normalizado TEXT NOT NULL UNIQUE,
  nome_original   TEXT NOT NULL,
  data_inicio     TEXT,
  observacao      TEXT,
  ativo           INTEGER NOT NULL DEFAULT 1,
  medico_id       INTEGER,
  atualizado_em   TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (medico_id) REFERENCES medicos(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS fellow_linhas (
  -- 1 linha por plantão. Chave natural: (mes_ref, data_plantao, fellow_norm, turno).
  -- mes_ref vem do nome da aba (autoritativo). Validamos data_plantao dentro dele.
  -- Snapshots de meta/valor_atend/valor_refeicao preservam histórico se config mudar.
  -- dia_semana: int 0-6 no padrão JS getDay (0=Domingo, 6=Sábado).
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  mes_ref         TEXT NOT NULL,
  data_plantao    TEXT NOT NULL,
  fellow_nome     TEXT NOT NULL,
  fellow_norm     TEXT NOT NULL,
  fellow_id       INTEGER,
  turno           TEXT NOT NULL,
  qtd_atendim     INTEGER NOT NULL DEFAULT 0,
  meta            INTEGER NOT NULL,
  valor_atendim   REAL NOT NULL,
  valor_refeicao  REAL NOT NULL,
  qtd_complem     INTEGER NOT NULL DEFAULT 0,
  valor_complem   REAL NOT NULL DEFAULT 0,
  refeicao        REAL NOT NULL DEFAULT 0,
  total_repassar  REAL NOT NULL DEFAULT 0,
  dia_semana      INTEGER NOT NULL,
  origem          TEXT,
  importado_em    TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(mes_ref, data_plantao, fellow_norm, turno),
  FOREIGN KEY (fellow_id) REFERENCES fellow_cadastro(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_fellow_mes ON fellow_linhas(mes_ref);
CREATE INDEX IF NOT EXISTS idx_fellow_norm ON fellow_linhas(fellow_norm);
CREATE INDEX IF NOT EXISTS idx_fellow_data ON fellow_linhas(data_plantao);
CREATE INDEX IF NOT EXISTS idx_fellow_id ON fellow_linhas(fellow_id);

CREATE TABLE IF NOT EXISTS log_auditoria (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  quando          TEXT DEFAULT CURRENT_TIMESTAMP,
  quem            TEXT,
  acao            TEXT NOT NULL,
  entidade        TEXT,
  entidade_id     INTEGER,
  detalhes        TEXT
);

-- ============================================================================
-- LAUDOS — vem em planilha externa com 3 abas. Aqui guardamos UNIFICADO.
-- ============================================================================
CREATE TABLE IF NOT EXISTS laudos (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  competencia     TEXT NOT NULL,             -- AAAA-MM
  categoria       TEXT NOT NULL,             -- 'PACOTE' | 'IMPRESSO' | 'EXTERNO'
  ordem           INTEGER,                   -- posição na aba original (pra preservar a ordem do setor)

  -- Identificação do laudo
  medico          TEXT,                      -- nome do profissional/executante/laudista
  exame           TEXT,                      -- nome do exame/laudo
  valor_repasse   REAL DEFAULT 0,            -- valor que o médico recebe

  -- Específicos de PACOTE
  unidade         TEXT,                      -- ex: ATLAS MATRIZ (forward-fill aplicado)
  convenio        TEXT,                      -- ex: SUL AMERICA (DF)
  quantidade      INTEGER DEFAULT 1,         -- qtd de exames (1 nas outras categorias)
  valor_unitario  REAL,                      -- preço unitário do exame

  -- Específicos de IMPRESSO (laudo no impresso individual)
  admissao        TEXT,                      -- cód. admissão
  data_admissao   TEXT,                      -- AAAA-MM-DD
  cod_paciente    TEXT,
  paciente        TEXT,
  fluxo           TEXT,                      -- ex: "atestado / laudo / relatórios - atlas"
  modulo          TEXT,                      -- texto bruto do campo "Modulo" da planilha

  -- Específicos de EXTERNO
  observacao      TEXT,                      -- ex: 'PARTICULAR'

  -- Flags derivadas (calculadas no import)
  pendente        INTEGER DEFAULT 0,         -- 1 se valor era "LANÇAR" ou vazio
  particular      INTEGER DEFAULT 0,         -- 1 se obs == PARTICULAR

  importado_em    TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_laudos_comp     ON laudos(competencia);
CREATE INDEX IF NOT EXISTS idx_laudos_cat      ON laudos(categoria);
CREATE INDEX IF NOT EXISTS idx_laudos_medico   ON laudos(medico);
CREATE INDEX IF NOT EXISTS idx_laudos_admissao ON laudos(admissao);

-- Tabela mestre de preços por exame (suprida pelo app, edita-se em Ajustes)
CREATE TABLE IF NOT EXISTS laudos_valores (
  exame              TEXT PRIMARY KEY,        -- nome canônico do exame
  valor_convenio     REAL DEFAULT 0,
  valor_particular   REAL DEFAULT 0,
  atualizado_em      TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Config geral do fichário Laudos
CREATE TABLE IF NOT EXISTS config_laudos (
  chave  TEXT PRIMARY KEY,
  valor  TEXT
);

-- Config de sistema (chave/valor de configurações gerais)
CREATE TABLE IF NOT EXISTS config_sistema (
  chave  TEXT PRIMARY KEY,
  valor  TEXT
);

-- ===================================================================
-- V489: SNAPSHOTS DA BASE TABELA (trilha de auditoria de valores)
-- Um snapshot por SESSÃO de desbloqueio (cadeado). Os itens guardam
-- o antes x depois de cada valor alterado durante aquela sessão.
-- ===================================================================
CREATE TABLE IF NOT EXISTS bt_snapshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  criado_em     TEXT DEFAULT CURRENT_TIMESTAMP,  -- ISO local (data + hora)
  usuario       TEXT,                            -- quem destravou
  motivo        TEXT,                            -- motivo escolhido na lista
  motivo_outro  TEXT,                            -- texto livre quando motivo = 'Outro'
  origem        TEXT                             -- 'EDICAO' | 'IMPORTACAO' | 'MISTO'
);

CREATE TABLE IF NOT EXISTS bt_snapshot_itens (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id    INTEGER NOT NULL,
  quando         TEXT DEFAULT CURRENT_TIMESTAMP,
  procedimento   TEXT,          -- nome do procedimento (congelado no momento)
  papel          TEXT,          -- Executante, Indicante, ...
  fonte_pagadora TEXT,          -- CONVENIO | PARTICULAR | SUS
  acao           TEXT,          -- 'ALTERACAO' | 'INCLUSAO' | 'EXCLUSAO'
  valor_antes    REAL,
  perc_antes     REAL,
  valor_depois   REAL,
  perc_depois    REAL,
  FOREIGN KEY (snapshot_id) REFERENCES bt_snapshots(id)
);
CREATE INDEX IF NOT EXISTS idx_bt_snap_item ON bt_snapshot_itens(snapshot_id);

-- ═══════════ MÓDULO EXTERNOS (V699) — repasse de médicos externos/híbridos ═══════════
-- O espaço verde envia só as ADMISSÕES; a ferramenta cruza com linhas_producao
-- e calcula o repasse pelas regras da base de cálculo (tabelas abaixo).

CREATE TABLE IF NOT EXISTS externos_admissoes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  cod_admissao  TEXT NOT NULL UNIQUE,
  origem        TEXT,                               -- arquivo de onde veio
  status        TEXT NOT NULL DEFAULT 'AGUARDANDO', -- AGUARDANDO | PAGO
  mes_repasse   TEXT,                               -- AAAA-MM (quando pago)
  pct_indicacao REAL,                               -- override por admissão (ex.: 18 quando a LIO é valor ATLAS)
  sem_hm        INTEGER NOT NULL DEFAULT 0,         -- 1 = externo que só encaminhou (não operou)
  observacao    TEXT,
  proc_planilha       TEXT,                         -- V828: nomenclatura do procedimento vinda da planilha importada
  medico_escolhido_id INTEGER,                      -- V828: médico escolhido no seletor da clínica (vale só p/ esta admissão)
  lio_tipo            TEXT,                         -- V840: marcação manual da LIO — 'PARCERIA' (deduz custo) | 'ATLAS' (sem dedução, % menor)
  importado_em  TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS externos_base_proc (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nome        TEXT NOT NULL UNIQUE,   -- FACO, ANTIGLAUCOMATOSA, ...
  mat_med     REAL NOT NULL DEFAULT 0,
  hm          REAL NOT NULL DEFAULT 0,
  mat_med_ao  REAL,                   -- valores para AO (ambos os olhos) quando existirem
  hm_ao       REAL,
  ativo       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS externos_base_lio (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  nome   TEXT NOT NULL UNIQUE,
  custo  REAL NOT NULL DEFAULT 0,
  ativo  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS externos_base_opme (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  nome   TEXT NOT NULL UNIQUE,
  custo  REAL NOT NULL DEFAULT 0,
  ativo  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS externos_clinicas (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  nome         TEXT NOT NULL UNIQUE,
  cnpj         TEXT,
  telefone     TEXT,
  email        TEXT,
  observacoes  TEXT,
  ativo        INTEGER NOT NULL DEFAULT 1,
  criado_em    TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS externos_config (
  chave  TEXT PRIMARY KEY,
  valor  TEXT NOT NULL
);
`;

const SEEDS_SQL = `
INSERT OR IGNORE INTO papeis (nome, descricao) VALUES
  ('Executante',   'Quem executa o procedimento (médico ou cirurgião)'),
  ('Auxiliar',     'Auxiliar do procedimento (recebe pelo nome do executante)'),
  ('Médico Laudo', 'Quem assina/emite o laudo'),
  ('Solicitante',  'Quem solicita o procedimento'),
  ('Indicante',    'Quem indica o paciente (paga o mesmo valor que Solicitante)');

INSERT OR IGNORE INTO mapeamento_papeis (papel_qvis, papel_id) VALUES
  ('MEDICO',             (SELECT id FROM papeis WHERE nome='Executante')),
  ('CIRURGIAO',          (SELECT id FROM papeis WHERE nome='Executante')),
  ('AUXILIAR 1',         (SELECT id FROM papeis WHERE nome='Auxiliar')),
  ('AUXILIAR 2',         (SELECT id FROM papeis WHERE nome='Auxiliar')),
  ('AUXILIAR SADT',      (SELECT id FROM papeis WHERE nome='Auxiliar')),
  ('MEDICO DE LAUDO',    (SELECT id FROM papeis WHERE nome='Médico Laudo')),
  ('MEDICO DO LAUDO 2',  (SELECT id FROM papeis WHERE nome='Médico Laudo')),
  ('SOLICITANTE',        (SELECT id FROM papeis WHERE nome='Solicitante')),
  ('INDICANTE',          (SELECT id FROM papeis WHERE nome='Indicante'));

INSERT OR IGNORE INTO tipos_pagamento_externo (codigo, nome, descricao) VALUES
  ('PERIODO_UNIDADE',   'Período por Unidade',     'Quantidade de períodos × valor por médico/unidade'),
  ('CARGO_FIXO',        'Cargo Fixo Mensal',       'Valor mensal fixo (Diretoria, RT, Coord. Fellow)'),
  ('PLANTAO_FELLOW',    'Plantão de Fellow',       'Plantões com qtd atendimento + complemento + refeição'),
  ('FRACIONAMENTO',     'Fracionamento',           'Aplicações escalonadas (Eylia, Lucentis...)'),
  ('PROC_AVULSO',       'Procedimento Avulso',     'Lançamento manual de procedimentos especiais'),
  ('OUTRO',             'Outros',                  'Tipo livre para casos não previstos');

-- Especialidades médicas padrão (você pode editar pela tela depois)
INSERT OR IGNORE INTO especialidades (nome, ordem) VALUES
  ('Catarata',          1),
  ('Refrativa',         2),
  ('Injeção',           3),
  ('Retina',            4),
  ('Plástica',          5),
  ('Córnea',            6),
  ('Glaucoma',          7),
  ('Lentes de Contato', 8),
  ('Laser',             9),
  ('Outras Cirurgias', 10);

INSERT OR IGNORE INTO valores_cargos (cargo, valor_mensal) VALUES
  ('DIRETORIA_TECNICA',   0),
  ('DIRETORIA_CLINICA',   0),
  ('COORDENADOR_MEDICO',  0),
  ('RESPONSAVEL_TECNICO', 0);

INSERT OR IGNORE INTO config_lentes_contato (chave, valor) VALUES
  ('PERCENTUAL_EXECUTANTE', 18),
  ('PERCENTUAL_INDICANTE',  9);

INSERT OR IGNORE INTO periodos_config (chave, valor) VALUES
  ('VALOR_PADRAO_PERIODO', '700');

INSERT OR IGNORE INTO fellow_config (chave, valor) VALUES
  ('META_ATENDIMENTOS',    '13'),
  ('VALOR_POR_ATENDIMENTO','38'),
  ('VALOR_REFEICAO',       '50');

-- Tabela mestre de preços de laudos (vem da aba "VALORES LAUDOS")
INSERT OR IGNORE INTO laudos_valores (exame, valor_convenio, valor_particular) VALUES
  ('ANGIOFLUORESCEINOGRAFIA',          11.43, 11.43),
  ('AUTOFLUORESCENCIA',                 4.94, 63.88),
  ('CAMPIMETRIA COMPUTADORIZADA',       6.72,  6.72),
  ('MICROSCOPIA ESPECULAR DE CORNEA',  22.85, 22.85),
  ('ORBSCAN / SCANSYS - CERATOSCOPIA', 21.82, 21.82),
  ('CERATOSCOPIA COMPUTADORIZADA',     12.02, 12.02),
  ('TOMOGRAFIA DE COERENCIA OPTICA - OCT', 20.00, 20.00),
  ('RETINOGRAFIA',                      8.20,  8.20);

INSERT OR IGNORE INTO config_laudos (chave, valor) VALUES
  ('OCULTAR_REPASSE',  '0');

-- ═══════════ SEEDS DO MÓDULO EXTERNOS (V699) ═══════════
-- Valores da planilha "BASE DE CÁLCULO REPASSE EXTERNO" (atualizar a cada 6 meses
-- pela tela Externos → Base de Cálculo — estes seeds só valem no primeiro uso).

INSERT OR IGNORE INTO externos_config (chave, valor) VALUES
  ('IMPOSTO_PCT',           '10'),
  ('INDICACAO_PCT',         '20'),
  ('INDICACAO_LIO_ATLAS_PCT', '18');

INSERT OR IGNORE INTO externos_base_proc (nome, mat_med, hm, mat_med_ao, hm_ao) VALUES
  ('FACO',                      330,     525.45,  660,     1050.9),
  ('ANTIGLAUCOMATOSA',          424,     346.84,  NULL,    NULL),
  ('VITRECTOMIA',               2328.15, 636.29,  NULL,    NULL),
  ('FACO + VITRECTOMIA',        2833.16, 1161.74, NULL,    NULL),
  ('PTERIGIO',                  80,      327.72,  160,     655.44),
  ('CICLOFOTOCOAGULACAO',       840.4,   203,     NULL,    NULL),
  ('FACO + ANTIGLAUCOMATOSA',   754,     872.29,  NULL,    NULL),
  ('LESAO OU TUMOR',            40,      113.93,  NULL,    NULL),
  ('LASER',                     0,       156.89,  0,       313.78),
  ('PRK',                       84,      571.86,  NULL,    NULL),
  ('EYLIA',                     325,     950,     650,     1900),
  ('PTOSE',                     136.86,  178.51,  NULL,    NULL),
  ('LUCENTIS',                  1289.21, 418.52,  NULL,    NULL),
  ('SUTURA DE CONJUNTIVA',      40,      50.43,   NULL,    NULL),
  ('RECONSTRUCAO DE PALPEBRAS', 135,     333.77,  NULL,    NULL),
  ('CANTOPLASTIA',              100,     101.15,  NULL,    NULL),
  ('OZURDEX',                   2477.44, 706.25,  4954.88, 1412.5),
  ('ECTROPIO',                  255.37,  159.04,  NULL,    NULL),
  ('TRIQUIASE',                 90,      83.49,   NULL,    NULL),
  ('AUTOTRANSPLANTE + BIOPSIA', 120,     242.2,   NULL,    NULL),
  ('EXERESE DE TUMOR',          120,     340.05,  NULL,    NULL),
  ('ESTRABISMO',                204.19,  136,     NULL,    NULL),
  ('PARACENTESE',               150,     0,       NULL,    NULL),
  ('LENTE PURE SEE',            3135.42, 0,       NULL,    NULL);

-- V840: nas planilhas reais do processo, o YAG em AMBOS os olhos paga UM HM
-- (156.89), não o dobro — corrige o valor sintético antigo sem tocar num
-- valor que o usuário já tenha editado na Base de Cálculo (guarda no WHERE)
UPDATE externos_base_proc SET hm_ao = 156.89 WHERE nome = 'LASER' AND hm_ao = 313.78;

INSERT OR IGNORE INTO externos_base_opme (nome, custo) VALUES
  ('IPRISM',    357.83),
  ('ISTENT',    7635.29),
  ('XEN',       6496.56),
  ('AHMED',     5322.51),
  ('PRESERFLO', 6119.50);

INSERT OR IGNORE INTO externos_base_lio (nome, custo) VALUES
  ('Acry-Philic A C-Loop',       50),
  ('MA60AC',                     95),
  ('SA60AT',                     95),
  ('SENSAR +6.0D ate +30.0D',    144.1),
  ('SENSAR +2.0D ate +5.5D',     542.72),
  ('SENSAR +5 ate -7',           542.72),
  ('SENSAR -1.0D ate -7.0D',     542.72),
  ('ISERT 255',                  237.54),
  ('ACRYSOF IQ WF',              454.6),
  ('CLAREON',                    565.38),
  ('CLAREON AUTONOME',           677.47),
  ('TECNIS ONE',                 256.75),
  ('TECNIS SIMPLICITY',          307.55),
  ('TECNIS EYHANCE',             818.86),
  ('Hoya Vivinex Impress',       845.3),
  ('Hoya Vivinex Toric',         750.75),
  ('TECNIS ONE TORICA',          846.65),
  ('ACRYSOF IQ TORIC',           1017.42),
  ('Clareon TORIC',              1192.27),
  ('Clareon TORIC Autonome',     1197.27),
  ('TECNIS EYHANCE TORICA II',   1272.55),
  ('TECNIS MF +3.25',            1500.51),
  ('TECNIS MF +4.00',            1500.51),
  ('TECNIS MF TORICA',           2481.62),
  ('TECNIS SYMFONY',             2100),
  ('PureSee',                    3135.42),
  ('VIVITY',                     3176.28),
  ('VIVITY Autonome',            3176.28),
  ('SYMFONY TORICA',             2869.32),
  ('PureSee Torica',             3135.42),
  ('VIVITY TORIC',               4271),
  ('Vivinex Gemetric',           2143.21),
  ('Vivinex Gemetric Plus',      2143.21),
  ('Galaxy',                     3800),
  ('SYNERGY',                    2850),
  ('Odyssey',                    3296.67),
  ('PANOPTIX',                   3264.26),
  ('PANOPTIX Autonome',          3264.26),
  ('PANOPTIX TORIC',             4389.31),
  ('PANOPTIX TORIC Autonome',    4389.31);

`;

window.SCHEMA_SQL = SCHEMA_SQL;
window.SEEDS_SQL = SEEDS_SQL;
