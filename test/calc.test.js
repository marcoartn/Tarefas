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
  assert.equal(r.preco, 18.12); // (10 + 4,50) / 0,8 = 18,125; em 18,12 a comissão arredonda p/ 3,62 e o lucro já é 0
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
      assert.ok(r.margemReal >= margemPct, `custo ${custo} margem ${margemPct}: margem real ${r.margemReal}`);
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

test('bate com o FaciliteMax: custo 12, imposto 4%, variáveis 1,50, margem 0%, taxa fixa R$ 4', () => {
  const r = calcular({ tipoVendedor: 'cpf', custoProduto: 12, impostoPct: 4, custosVariaveis: 1.5, modo: 'margem', margemPct: 0,
    taxas: { comissaoPct: 20, comissaoTeto: 100, taxaFixa: 4, taxaCpf: 3 } });
  assert.equal(r.preco, 26.97);
  assert.equal(r.comissao, 5.39);
  assert.equal(r.imposto, 1.08);
  assert.equal(r.totalCustos, 26.97);
  assert.equal(r.lucro, 0);
});

test('margem real nunca aparece abaixo da pedida (caso R$ 15,75 → 6,98%)', () => {
  const r = calcular({ tipoVendedor: 'cpf', custoProduto: 4, impostoPct: 0, custosVariaveis: 0, modo: 'margem', margemPct: 7 });
  assert.ok(r.margemReal >= 7, `margem real ${r.margemReal}`);
});

// ---------- Revisão matemática: propriedades que valem para QUALQUER entrada ----------
import { detalharPreco, normalizarEntrada } from '../public/calc.js';

const TX = { comissaoPct: 20, comissaoTeto: 100, taxaFixa: 4.5, taxaCpf: 3 };
const c2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
function aleatorio(semente) {
  let s = semente;
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
}
function casoAleatorio(R) {
  const produtos = Array.from({ length: 1 + Math.floor(R() * 3) }, () => ({ custo: c2(R() * 400), quantidade: 1 + Math.floor(R() * 4) }));
  return {
    tipoVendedor: R() < 0.5 ? 'cpf' : 'cnpj', produtos,
    impostoPct: [0, 4, 6, 8.5, 11.2, 15][Math.floor(R() * 6)], custosVariaveis: c2(R() * 6),
    extras: R() < 0.4 ? [{ nome: 'x', tipo: R() < 0.5 ? 'percentual' : 'fixo', valor: c2(R() * 6) }] : [],
    modo: ['margem', 'lucro', 'preco'][Math.floor(R() * 3)],
    margemPct: c2(R() * 45), lucroDesejado: c2(R() * 40), precoVenda: c2(R() * 900),
    taxas: { ...TX, taxaFixa: R() < 0.5 ? 4 : 4.5, comissaoTeto: R() < 0.2 ? 0 : 100 },
  };
}

test('propriedades em 10.000 casos aleatórios (todos os modos, kits, extras, teto)', () => {
  const R = aleatorio(20260923);
  let verificados = 0;
  for (let i = 0; i < 10000; i++) {
    const ent = casoAleatorio(R);
    const r = calcular(ent);
    if (r.erro) continue;
    const e = normalizarEntrada(ent);
    const ctx = JSON.stringify(ent);
    // 1. O preço fecha: custos + lucro = preço (no centavo), quando há preço
    if (r.preco > 0) assert.equal(c2(r.totalCustos + r.lucro), r.preco, `não fecha: ${ctx}`);
    // 2. Comissão = 20% do preço, limitada ao teto
    const bruta = r.preco * e.taxas.comissaoPct / 100;
    const esperada = c2(e.taxas.comissaoTeto > 0 ? Math.min(bruta, e.taxas.comissaoTeto) : bruta);
    assert.equal(r.comissao, esperada, `comissão: ${ctx}`);
    // 3. Total de custos = soma das partes
    const soma = c2(r.custoProdutoTotal + r.custosVariaveis + r.extrasTotal + r.comissao + r.imposto + r.taxaFixa + r.taxaCpf);
    assert.equal(r.totalCustos, soma, `total: ${ctx}`);
    // 4. Kit: custo do produto = Σ custo × quantidade
    assert.equal(r.custoProdutoTotal, c2(e.produtos.reduce((s, p) => s + p.custo * p.quantidade, 0)), `kit: ${ctx}`);
    if (e.modo === 'preco' || r.preco <= 0) continue;
    // 5. A meta é atingida e 6. é o MENOR preço que atinge (um centavo a menos não atinge)
    const ok = (d) => (e.modo === 'margem' ? d.lucro >= d.preco * e.margemPct / 100 - 1e-9 : d.lucro >= c2(e.lucroDesejado));
    assert.ok(ok(r), `meta não atingida: ${ctx} → ${r.preco}`);
    assert.ok(!ok(detalharPreco(c2(r.preco - 0.01), e)), `não é o mínimo: ${ctx} → ${r.preco}`);
    verificados++;
  }
  assert.ok(verificados > 3000, `poucos casos verificados: ${verificados}`);
});

test('mais custo nunca dá preço menor (monotonicidade)', () => {
  let anterior = 0;
  for (let custo = 0.5; custo <= 800; custo += 3.37) {
    const r = calcular({ custoProduto: custo, impostoPct: 6, custosVariaveis: 1, margemPct: 12, taxas: TX });
    assert.ok(r.preco >= anterior, `custo ${custo}: ${r.preco} < ${anterior}`);
    anterior = r.preco;
  }
});

test('números no formato brasileiro', () => {
  const custo = (v) => normalizarEntrada({ custoProduto: v }).custoProduto;
  assert.equal(custo('12,50'), 12.5);
  assert.equal(custo('1.234,56'), 1234.56);
  assert.equal(custo('R$ 12,50'), 12.5);
  assert.equal(custo(' 12,5 '), 12.5);
  assert.equal(custo('4.5'), 4.5);
  assert.equal(custo('1.234.567'), 1234567);
  assert.equal(custo('abc'), 0);
  assert.equal(custo(''), 0);
  assert.equal(normalizarEntrada({ impostoPct: '8,5 %' }).impostoPct, 8.5);
});

test('margem ou lucro negativos viram zero (sem preço com prejuízo por engano)', () => {
  assert.equal(normalizarEntrada({ margemPct: '-10' }).margemPct, 0);
  assert.equal(normalizarEntrada({ lucroDesejado: -3 }).lucroDesejado, 0);
  assert.ok(calcular({ custoProduto: 10, margemPct: -10, taxas: TX }).lucro >= 0);
});

test('preço de venda com mais de 2 casas é tratado já em centavos', () => {
  const r = calcular({ custoProduto: 10, modo: 'preco', precoVenda: 29.996, taxas: TX });
  assert.equal(r.preco, 30);
  assert.equal(c2(r.totalCustos + r.lucro), 30);
});

test('margem real exibida nunca é maior que a exata (truncada em 2 casas)', () => {
  const R = aleatorio(7);
  for (let i = 0; i < 3000; i++) {
    const r = calcular({ custoProduto: c2(R() * 200), modo: 'preco', precoVenda: c2(10 + R() * 400), impostoPct: 6, taxas: TX });
    if (r.preco <= 0) continue;
    const exata = (r.lucro / r.preco) * 100;
    assert.ok(r.margemReal <= exata + 1e-9, `${r.margemReal} > ${exata}`);
    assert.ok(exata - r.margemReal < 0.01 + 1e-9);
  }
});
