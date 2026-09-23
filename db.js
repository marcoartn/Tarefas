import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { TAXAS_PADRAO } from './public/calc.js';

export function abrirBanco(caminho) {
  if (caminho !== ':memory:') mkdirSync(dirname(caminho), { recursive: true });
  const db = new DatabaseSync(caminho);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS anuncios (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      nome               TEXT    NOT NULL,
      comentario         TEXT    NOT NULL DEFAULT '',
      imagem             TEXT,
      -- entradas
      tipo_vendedor      TEXT    NOT NULL CHECK (tipo_vendedor IN ('cpf','cnpj')),
      custo_produto      REAL    NOT NULL,
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

    CREATE TABLE IF NOT EXISTS config (
      chave TEXT PRIMARY KEY,
      valor TEXT NOT NULL
    );
  `);
  const ins = db.prepare('INSERT OR IGNORE INTO config (chave, valor) VALUES (?, ?)');
  ins.run('taxas', JSON.stringify(TAXAS_PADRAO));
  return db;
}
