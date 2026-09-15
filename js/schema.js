/**
 * ============================================================================
 * ATLAS — SCHEMA DO BANCO (DDL idempotente)
 *
 * Multi-cliente por desenho: TODA tabela de dados carrega `cliente_id`.
 * Um cliente é quem contrata a auditoria (médico, clínica ou grupo);
 * cada cliente tem 1+ hospitais (as instituições que emitem os relatórios
 * de produção e de repasse dele).
 *
 * O fluxo de dados:
 *   clientes ─ hospitais ─ perfis_importacao (mapeamento de colunas salvo)
 *      │
 *      ├─ importacoes ─ linhas_producao  (o que foi FEITO — formato largo:
 *      │                                  papéis em colunas)
 *      ├─ importacoes ─ linhas_repasse   (o que foi PAGO — formato longo:
 *      │                                  papel + médico por linha)
 *      ├─ base_tabela                    (regras: procedimento × papel × fonte,
 *      │                                  opcional — quando o hospital fornece)
 *      └─ pauta_inspecao                 (admissões em acompanhamento/cobrança)
 *
 * Convenção: rodado inteiro a cada boot com CREATE TABLE IF NOT EXISTS —
 * alterações de schema entram como migração defensiva no banco.js.
 * ============================================================================
 */
(function () {
  'use strict';

  window.SCHEMA_SQL = `

-- ====================================================================
-- CLIENTES DA ATLAS (quem contrata a auditoria)
-- ====================================================================
CREATE TABLE IF NOT EXISTS clientes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nome        TEXT NOT NULL,
  tipo        TEXT DEFAULT 'MEDICO',        -- MEDICO | CLINICA | GRUPO
  documento   TEXT,                         -- CRM / CNPJ (livre)
  contato     TEXT,                         -- e-mail / telefone (livre)
  observacao  TEXT,
  ativo       INTEGER DEFAULT 1,
  criado_em   TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Instituições que emitem os relatórios do cliente
CREATE TABLE IF NOT EXISTS hospitais (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id  INTEGER NOT NULL,
  nome        TEXT NOT NULL,
  observacao  TEXT,
  criado_em   TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cliente_id) REFERENCES clientes(id)
);
CREATE INDEX IF NOT EXISTS idx_hosp_cliente ON hospitais(cliente_id);

-- ====================================================================
-- IMPORTAÇÕES (lotes) + PERFIS DE MAPEAMENTO DE COLUNAS
-- ====================================================================
-- Cada hospital exporta relatórios num formato próprio. O mapeamento
-- (coluna da planilha → campo da ATLAS) é salvo por hospital × tipo e
-- reaplicado automaticamente nas próximas importações.
CREATE TABLE IF NOT EXISTS perfis_importacao (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id   INTEGER NOT NULL,
  tipo          TEXT NOT NULL,              -- PRODUCAO | REPASSE | BASE_TABELA
  mapeamento    TEXT NOT NULL,              -- JSON { campo: nomeColunaPlanilha }
  linha_cabecalho INTEGER DEFAULT 0,        -- índice (0-based) da linha de cabeçalho
  atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (hospital_id, tipo),
  FOREIGN KEY (hospital_id) REFERENCES hospitais(id)
);

CREATE TABLE IF NOT EXISTS importacoes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id   INTEGER NOT NULL,
  hospital_id  INTEGER NOT NULL,
  tipo         TEXT NOT NULL,               -- PRODUCAO | REPASSE | BASE_TABELA
  arquivo      TEXT,                        -- nome do arquivo original
  competencia  TEXT,                        -- YYYY-MM informada no import (repasse)
  n_linhas     INTEGER DEFAULT 0,
  origem       TEXT,                        -- SISTEMA: CONVENIO | PARTICULAR | TODAS (v0.7)
  importada_em TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cliente_id)  REFERENCES clientes(id),
  FOREIGN KEY (hospital_id) REFERENCES hospitais(id)
);
CREATE INDEX IF NOT EXISTS idx_imp_cliente ON importacoes(cliente_id);

-- ====================================================================
-- PRODUÇÃO — o que foi FEITO (1 linha = 1 item produzido numa admissão)
-- Formato LARGO: cada papel é uma coluna (como os relatórios de produção
-- costumam vir). Nomes de médico guardados crus + normalizados.
-- ====================================================================
CREATE TABLE IF NOT EXISTS linhas_producao (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id    INTEGER NOT NULL,
  hospital_id   INTEGER NOT NULL,
  importacao_id INTEGER,
  competencia   TEXT,                       -- YYYY-MM (derivada da data)
  admissao      TEXT,
  admissao_norm TEXT,                       -- só dígitos, sem zeros à esquerda (índice de busca)
  data          TEXT,                       -- YYYY-MM-DD
  paciente      TEXT,
  paciente_norm TEXT,
  convenio      TEXT,
  fonte         TEXT DEFAULT 'CONVENIO',    -- CONVENIO | PARTICULAR | SUS
  classificacao TEXT,                       -- PROCEDIMENTO/EXAME/CONSULTA/OPME/TAXA/...
  procedimento  TEXT,
  procedimento_norm TEXT,
  quantidade    REAL DEFAULT 1,
  valor         REAL DEFAULT 0,             -- valor produzido/faturado do item

  executante    TEXT,  executante_norm  TEXT,
  auxiliar      TEXT,  auxiliar_norm    TEXT,
  indicante     TEXT,  indicante_norm   TEXT,
  solicitante   TEXT,  solicitante_norm TEXT,
  laudo         TEXT,  laudo_norm       TEXT,

  linha_origem  INTEGER,                    -- nº da linha na planilha (rastreio)

  -- v0.6: a ÍNTEGRA do relatório analítico (importação automática de
  -- produção — as colunas que não viram campo-núcleo ficam guardadas aqui;
  -- em banco antigo entram por migração defensiva no banco.js)
  hora_admissao TEXT, status_admissao TEXT, unidade TEXT, especialidade TEXT,
  destino TEXT, tipo_produto TEXT, categoria TEXT, subcategoria TEXT,
  subespecialidade TEXT, medico_externo TEXT, cod_apresentacao TEXT,
  procedimento_principal TEXT, pacote TEXT, plano TEXT, perfil_particular TEXT,
  perfil_admissao TEXT, carater_admissao TEXT, observacao_admissao TEXT,
  sala TEXT, profissional_admissao TEXT, tipo_paciente TEXT, cod_paciente TEXT,
  data_nascimento TEXT, idade_atendimento REAL, faixa_etaria TEXT, cid_alta TEXT,
  descricao_cid TEXT, consultor TEXT, medico TEXT, cirurgiao TEXT,
  instrumentador TEXT, contatologa TEXT, ortoptista TEXT, auxiliar_sadt TEXT,
  auxiliar2 TEXT,
  FOREIGN KEY (importacao_id) REFERENCES importacoes(id)
);
CREATE INDEX IF NOT EXISTS idx_prod_cli_adm  ON linhas_producao(cliente_id, admissao);
CREATE INDEX IF NOT EXISTS idx_prod_cli_comp ON linhas_producao(cliente_id, competencia);
CREATE INDEX IF NOT EXISTS idx_prod_proc     ON linhas_producao(procedimento_norm);

-- ====================================================================
-- REPASSE — o relatório cru do SISTEMA do hospital
-- (1 linha = papel × procedimento × admissão). Formato LONGO (estilo QVIS).
--
-- As quatro colunas de dinheiro têm pesos MUITO diferentes na auditoria:
--   produzido  o que foi faturado do item
--   honorario  a parcela de honorário do produzido
--   recebido   O QUE O PAGADOR PAGOU — manda: 0 em convênio/SUS = GLOSA
--   repassado  o que o SISTEMA diz que passou ao médico — INFORMATIVO
-- ====================================================================
CREATE TABLE IF NOT EXISTS linhas_repasse (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id    INTEGER NOT NULL,
  hospital_id   INTEGER NOT NULL,
  importacao_id INTEGER,
  competencia   TEXT,                       -- YYYY-MM do PAGAMENTO (informada no import)
  admissao      TEXT,
  admissao_norm TEXT,                       -- só dígitos (índice de busca)
  data          TEXT,                       -- data da admissão/atendimento se houver
  paciente      TEXT,
  convenio      TEXT,
  fonte         TEXT DEFAULT 'CONVENIO',
  procedimento  TEXT,
  procedimento_norm TEXT,
  papel         TEXT,                       -- texto cru do relatório
  papel_canon   TEXT,                       -- papel canônico (EXECUTANTE/AUXILIAR/...)
  medico        TEXT,
  medico_norm   TEXT,
  quantidade    REAL DEFAULT 1,
  produzido     REAL DEFAULT 0,             -- valor de produção informado no repasse
  honorario     REAL,                       -- parcela de honorário do produzido (null = coluna ausente)
  recebido      REAL,                       -- O QUE O PAGADOR PAGOU ao hospital. É a coluna que manda:
                                            -- recebido = 0 em convênio/SUS é GLOSA (docs/METODOLOGIA.md §5).
                                            -- null = o relatório não trouxe a coluna
  repassado     REAL DEFAULT 0,             -- o que o SISTEMA diz que passou ao médico (informativo:
                                            -- nem toda regra está cadastrada lá — nunca é a régua do esperado)
  status        TEXT,                       -- status da linha no relatório (detecção de GLOSA)

  linha_origem  INTEGER,
  FOREIGN KEY (importacao_id) REFERENCES importacoes(id)
);
CREATE INDEX IF NOT EXISTS idx_rep_cli_adm  ON linhas_repasse(cliente_id, admissao);
CREATE INDEX IF NOT EXISTS idx_rep_cli_comp ON linhas_repasse(cliente_id, competencia);
CREATE INDEX IF NOT EXISTS idx_rep_proc     ON linhas_repasse(procedimento_norm);
CREATE INDEX IF NOT EXISTS idx_rep_medico   ON linhas_repasse(medico_norm);

-- ====================================================================
-- RELATÓRIO DO MÉDICO — o que ele DE FATO recebeu (demonstrativo usado
-- para emitir a nota). Terceira base do triângulo da auditoria:
-- PRODUÇÃO (feito) × SISTEMA (o hospital diz que pagou) × MÉDICO (recebeu).
-- Importado pelo módulo Inspeção; aceita as três gerações de layout.
-- ====================================================================
CREATE TABLE IF NOT EXISTS linhas_medico (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id    INTEGER NOT NULL,
  hospital_id   INTEGER NOT NULL,
  importacao_id INTEGER,
  competencia   TEXT,                       -- YYYY-MM do relatório (mês do pagamento)
  sistema       TEXT,                       -- QVIS / Medical / Ajustes / Desempenho / GLOSA…
  modulo        TEXT,                       -- Repasse / LIO / OPME… (gen 3)
  admissao      TEXT,                       -- vazia na gen 1 (resolvida por paciente+data)
  admissao_norm TEXT,                       -- só dígitos (índice de busca)
  admissao_origem TEXT,                     -- RELATORIO | RESOLVIDA | ''
  data          TEXT,                       -- YYYY-MM-DD
  paciente      TEXT,
  paciente_norm TEXT,
  medico        TEXT,
  medico_norm   TEXT,
  papel         TEXT,
  papel_canon   TEXT,
  fonte         TEXT DEFAULT 'CONVENIO',
  convenio      TEXT,
  procedimento  TEXT,
  procedimento_norm TEXT,
  valor         REAL DEFAULT 0,             -- pode ser negativo (estorno)
  linha_origem  INTEGER,
  FOREIGN KEY (importacao_id) REFERENCES importacoes(id)
);
CREATE INDEX IF NOT EXISTS idx_med_cli_adm  ON linhas_medico(cliente_id, admissao);
CREATE INDEX IF NOT EXISTS idx_med_cli_comp ON linhas_medico(cliente_id, competencia);
CREATE INDEX IF NOT EXISTS idx_med_pac_data ON linhas_medico(cliente_id, paciente_norm, data);

-- ====================================================================
-- BASE TABELA — regras de repasse (quando o hospital/clínica fornece)
-- valor OU percentual: valor fixo em R$ (convênio/SUS, tipicamente) ou
-- % sobre o valor produzido (particular, tipicamente).
-- origem: MANUAL (digitada), IMPORTADA (planilha), INFERIDA (aprendida
-- pelo motor e promovida pelo usuário).
-- ====================================================================
CREATE TABLE IF NOT EXISTS base_tabela (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id   INTEGER NOT NULL,
  procedimento  TEXT NOT NULL,
  procedimento_norm TEXT NOT NULL,
  papel         TEXT NOT NULL DEFAULT 'EXECUTANTE',   -- papel canônico
  fonte         TEXT NOT NULL DEFAULT 'TODAS',        -- CONVENIO|PARTICULAR|SUS|TODAS
  valor         REAL,                                 -- R$ fixo (null = não usa)
  percentual    REAL,                                 -- % sobre produzido (null = não usa)
  origem        TEXT DEFAULT 'MANUAL',
  amostras      INTEGER,                              -- nº de amostras (regra inferida)
  confianca     REAL,                                 -- 0..1 (regra inferida)
  criado_em     TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitais(id)
);
CREATE INDEX IF NOT EXISTS idx_bt_hosp ON base_tabela(hospital_id, procedimento_norm);

-- ====================================================================
-- PAUTA DE INSPEÇÃO — admissões em acompanhamento (vigias)
-- O produto do serviço: o que a ATLAS está cobrando para o cliente.
-- ====================================================================
CREATE TABLE IF NOT EXISTS pauta_inspecao (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id    INTEGER NOT NULL,
  hospital_id   INTEGER,
  admissao      TEXT NOT NULL,
  situacao      TEXT DEFAULT 'PENDENTE',    -- PENDENTE | COBRADO | RESOLVIDO | DESCARTADO
  anotacao      TEXT,
  valor_apurado REAL,                       -- falta apurada no momento da inclusão
  criado_em     TEXT DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT,
  UNIQUE (cliente_id, admissao)
);
CREATE INDEX IF NOT EXISTS idx_pauta_cli ON pauta_inspecao(cliente_id, situacao);

-- ====================================================================
-- DE-PARA DE MÉDICOS — grafias diferentes do mesmo profissional
-- (lição central da metodologia: sem isso nenhum cruzamento fecha)
-- ====================================================================
CREATE TABLE IF NOT EXISTS medicos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id   INTEGER NOT NULL,
  nome_oficial TEXT NOT NULL,
  nome_norm    TEXT NOT NULL,
  criado_em    TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_med_cli ON medicos(cliente_id, nome_norm);

CREATE TABLE IF NOT EXISTS sinonimos_medico (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  medico_id  INTEGER NOT NULL,
  grafia     TEXT NOT NULL,
  grafia_norm TEXT NOT NULL,
  FOREIGN KEY (medico_id) REFERENCES medicos(id)
);
CREATE INDEX IF NOT EXISTS idx_sinmed_norm ON sinonimos_medico(grafia_norm);

-- ====================================================================
-- CONFIGURAÇÃO GERAL (chave/valor JSON)
-- ====================================================================
CREATE TABLE IF NOT EXISTS config (
  chave         TEXT PRIMARY KEY,
  valor         TEXT,
  atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP
);
`;

  /** Seeds mínimos — só configuração; a ferramenta nasce sem dados. */
  window.SCHEMA_SEEDS = `
INSERT OR IGNORE INTO config (chave, valor) VALUES ('tolerancia_centavos', '0.05');
INSERT OR IGNORE INTO config (chave, valor) VALUES ('inferencia_min_amostras', '3');
INSERT OR IGNORE INTO config (chave, valor) VALUES ('inferencia_min_confianca', '0.6');
INSERT OR IGNORE INTO config (chave, valor) VALUES ('fuzzy_limiar', '0.88');
INSERT OR IGNORE INTO config (chave, valor) VALUES ('institucional_marca', '');
`;
})();
