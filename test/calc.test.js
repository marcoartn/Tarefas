import test from 'node:test';
import assert from 'node:assert/strict';
import { calcular } from '../public/calc.js';

const base = { tipoVendedor: 'cpf', custoProduto: 10, impostoPct: 0, custosVariaveis: 0 };

test('por margem: lucro entregue bate com a margem pedida', () => {
  const r = calcular({ ...base, modo: 'margem', margemPct: 10 });
  // P = (10 + 4.5 + 3) / (1 - 0.20 - 0.10) = 25
  assert.equal(r.preco, 25);
  assert.ok(r.margemReal >= 10);
  assert.equal(r.totalCustos + r.lucro, r.preco);
});

test('CNPJ não paga a taxa extra', () => {
  const r = calcular({ ...base, tipoVendedor: 'cnpj', modo: 'margem', margemPct: 0 });
  assert.equal(r.taxaCpf, 0);
  assert.equal(r.preco, 18.13); // (10 + 4.5) / 0.8 = 18.125 → 18.13
});

test('por preço de venda: detalha e calcula lucro', () => {
  const r = calcular({ ...base, modo: 'preco', precoVenda: 30, impostoPct: 6 });
  assert.equal(r.comissao, 6);
  assert.equal(r.imposto, 1.8);
  assert.equal(r.lucro, 4.7); // 30 - 10 - 6 - 1,80 - 4,50 - 3
});

test('por lucro desejado', () => {
  const r = calcular({ ...base, modo: 'lucro', lucroDesejado: 5 });
  assert.ok(r.lucro >= 5 && r.lucro < 5.02);
});

test('quantidade multiplica o custo do produto (kits)', () => {
  const r = calcular({ ...base, quantidade: 3, modo: 'preco', precoVenda: 50 });
  assert.equal(r.custoProdutoTotal, 30);
});

test('teto da comissão é respeitado em produtos caros', () => {
  const r = calcular({ ...base, custoProduto: 1000, modo: 'margem', margemPct: 10 });
  assert.equal(r.comissao, 100);
  assert.ok(r.comissaoLimitada);
  assert.ok(r.margemReal >= 10);
});

test('extras fixos e percentuais entram no cálculo', () => {
  const r = calcular({ ...base, modo: 'preco', precoVenda: 100, extras: [{ nome: 'Ads', tipo: 'percentual', valor: 5 }, { nome: 'Brinde', tipo: 'fixo', valor: 2 }] });
  assert.equal(r.extrasTotal, 7);
});

test('percentuais impossíveis retornam erro', () => {
  const r = calcular({ ...base, modo: 'margem', margemPct: 85 });
  assert.ok(r.erro);
});

test('aceita vírgula como separador decimal', () => {
  const r = calcular({ ...base, custoProduto: '10,50', modo: 'preco', precoVenda: '40,00' });
  assert.equal(r.custoProdutoTotal, 10.5);
  assert.equal(r.preco, 40);
});

test('arredondamento de centavos nunca entrega margem abaixo da pedida', () => {
  for (let custo = 1; custo <= 60; custo += 0.37) {
    for (const margemPct of [5, 7, 12, 18, 25]) {
      const r = calcular({ ...base, custoProduto: custo, impostoPct: 4, custosVariaveis: 1.5, modo: 'margem', margemPct });
      assert.ok(r.lucro >= Math.round(r.preco * margemPct) / 100, `custo ${custo} margem ${margemPct}: ${r.preco} → ${r.lucro}`);
    }
  }
});

test('caminho do banco: DB_PATH > volume do Railway > ./data', async () => {
  const { caminhoBanco } = await import('../db.js');
  assert.equal(caminhoBanco('/app', { DB_PATH: '/x/a.db', RAILWAY_VOLUME_MOUNT_PATH: '/data' }), '/x/a.db');
  assert.equal(caminhoBanco('/app', { RAILWAY_VOLUME_MOUNT_PATH: '/data' }), '/data/precificador.db');
  assert.equal(caminhoBanco('/app', {}), '/app/data/precificador.db');
});

test('tela vazia mostra as taxas por item e lucro zero', () => {
  const cpf = calcular({});
  assert.equal(cpf.preco, 0);
  assert.equal(cpf.taxaFixa, 4.5);
  assert.equal(cpf.taxaCpf, 3);
  assert.equal(cpf.totalCustos, 7.5);
  assert.equal(cpf.lucro, 0);
  const cnpj = calcular({ tipoVendedor: 'cnpj' });
  assert.equal(cnpj.taxaCpf, 0);
  assert.equal(cnpj.totalCustos, 4.5);
});

test('kit com vários produtos soma custo × quantidade de cada um', () => {
  const r = calcular({ ...base, produtos: [{ custo: '5,00', quantidade: 2 }, { custo: 4, quantidade: 1 }], modo: 'preco', precoVenda: 40 });
  assert.equal(r.custoProdutoTotal, 14);
  assert.equal(r.entrada.produtos.length, 2);
  // Mesmo preço que um produto único de R$ 14
  const unico = calcular({ ...base, custoProduto: 14, modo: 'margem', margemPct: 10 });
  const kit = calcular({ ...base, produtos: [{ custo: 5, quantidade: 2 }, { custo: 4, quantidade: 1 }], modo: 'margem', margemPct: 10 });
  assert.equal(kit.preco, unico.preco);
});

test('formato antigo (custoProduto + quantidade) continua funcionando', () => {
  const r = calcular({ ...base, custoProduto: 3, quantidade: 4, modo: 'preco', precoVenda: 30 });
  assert.deepEqual(r.entrada.produtos, [{ custo: 3, quantidade: 4 }]);
  assert.equal(r.custoProdutoTotal, 12);
});
