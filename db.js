import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { TAXAS_PADRAO } from './public/calc.js';

// Onde fica o arquivo do banco: DB_PATH, senão o volume do Railway
// (que ele informa em RAILWAY_VOLUME_MOUNT_PATH), senão ./data do projeto.
export function caminhoBanco(raizProjeto, env = process.env) {
  if (env.DB_PATH) return env.DB_PATH;
  if (env.RAILWAY_VOLUME_MOUNT_PATH) return join(env.RAILWAY_VOLUME_MOUNT_PATH, 'precificador.db');
  return join(raizProjeto, 'data', 'precificador.db');
}

export function abrirBanco(caminho) {
  if (caminho !== ':memory:') mkdirSync(dirname(caminho), { recursive: true });
  const db = new DatabaseSync(caminho);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS lojas (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      nome       TEXT NOT NULL,
      email      TEXT NOT NULL UNIQUE COLLATE NOCASE,
      senha_hash TEXT NOT NULL,
      taxas      TEXT NOT NULL DEFAULT '${JSON.stringify(TAXAS_PADRAO)}',
      criado_em  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Guardamos só o hash do token: quem ler o banco não consegue usar as sessões.
    CREATE TABLE IF NOT EXISTS sessoes (
      token_hash TEXT PRIMARY KEY,
      loja_id    INTEGER NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
      expira_em  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessoes_loja ON sessoes(loja_id);

    CREATE TABLE IF NOT EXISTS anuncios (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      loja_id            INTEGER REFERENCES lojas(id) ON DELETE CASCADE,
      nome               TEXT    NOT NULL,
      comentario         TEXT    NOT NULL DEFAULT '',
      imagem             TEXT,
      -- entradas
      tipo_vendedor      TEXT    NOT NULL CHECK (tipo_vendedor IN ('cpf','cnpj')),
      custo_produto      REAL    NOT NULL,
      produtos           TEXT    NOT NULL DEFAULT '[]', -- kit: [{custo, quantidade}]
      quantidade         INTEGER NOT NULL,
      imposto_pct        REAL    NOT NULL,
      custos_variaveis   REAL    NOT NULL,
      extras             TEXT    NOT NULL DEFAULT '[]',
      modo               TEXT    NOT NULL CHECK (modo IN ('margem','preco','lucro')),
      margem_pct         REAL    NOT NULL,
      preco_venda_input  REAL    NOT NULL,
      lucro_desejado     REAL    NOT NULL,
      -- taxas vigentes no momento do cálculo (congeladas no anúncio)
      comissao_pct       REAL    NOT NULL,
      comissao_teto      REAL    NOT NULL,
      taxa_fixa          REAL    NOT NULL,
      taxa_cpf           REAL    NOT NULL,
      -- resultados (recalculados pelo servidor)
      preco              REAL    NOT NULL,
      comissao           REAL    NOT NULL,
      imposto            REAL    NOT NULL,
      extras_total       REAL    NOT NULL,
      total_custos       REAL    NOT NULL,
      lucro              REAL    NOT NULL,
      margem_real        REAL    NOT NULL,
      criado_em          TEXT    NOT NULL DEFAULT (datetime('now')),
      atualizado_em      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS anuncio_tags (
      anuncio_id INTEGER NOT NULL REFERENCES anuncios(id) ON DELETE CASCADE,
      tag        TEXT    NOT NULL COLLATE NOCASE,
      PRIMARY KEY (anuncio_id, tag)
    );
    CREATE INDEX IF NOT EXISTS idx_tags_tag ON anuncio_tags(tag);
  `);

  // Bancos criados antes das contas não tinham loja_id: adiciona a coluna.
  // Esses anúncios "sem dono" são adotados pela primeira loja cadastrada.
  const colunas = db.prepare('PRAGMA table_info(anuncios)').all().map((c) => c.name);
  if (!colunas.includes('loja_id')) {
    db.exec('ALTER TABLE anuncios ADD COLUMN loja_id INTEGER REFERENCES lojas(id) ON DELETE CASCADE');
  }
  if (!colunas.includes('produtos')) {
    db.exec("ALTER TABLE anuncios ADD COLUMN produtos TEXT NOT NULL DEFAULT '[]'");
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_anuncios_loja ON anuncios(loja_id, atualizado_em)');
  return db;
}
