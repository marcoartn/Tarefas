import test from 'node:test';
import assert from 'node:assert/strict';
import { abrirBanco } from '../db.js';
import { criarRepo } from '../repo.js';
import { criarApp } from '../server.js';

async function subir() {
  const app = criarApp(criarRepo(abrirBanco(':memory:')));
  await new Promise((ok) => app.listen(0, ok));
  const url = `http://127.0.0.1:${app.address().port}/api`;
  const req = async (caminho, metodo = 'GET', corpo) => {
    const r = await fetch(url + caminho, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: corpo && JSON.stringify(corpo) });
    return { status: r.status, dados: r.status === 204 ? null : await r.json() };
  };
  return { app, req };
}

test('CRUD de anúncios com recálculo no servidor', async (t) => {
  const { app, req } = await subir();
  t.after(() => app.close());

  // Cliente manda um "preco" falso; o servidor ignora e recalcula.
  const criado = await req('/anuncios', 'POST', {
    nome: 'Body Bebê', tipoVendedor: 'cpf', custoProduto: 10, modo: 'margem', margemPct: 10,
    tags: ['Ranqueamento', 'ranqueamento', 'Kit'], comentario: 'teste', preco: 1, resultado: { preco: 1 },
  });
  assert.equal(criado.status, 201);
  assert.equal(criado.dados.resultado.preco, 24.29);
  assert.deepEqual(criado.dados.tags, ['Ranqueamento', 'Kit']);
  const id = criado.dados.id;

  const editado = await req(`/anuncios/${id}`, 'PUT', { ...criado.dados, tipoVendedor: 'cnpj', tags: ['Kit'] });
  assert.equal(editado.dados.resultado.preco, 20); // (10 + 4) / (1 - 0.2 - 0.1)
  assert.deepEqual(editado.dados.tags, ['Kit']);

  const dup = await req(`/anuncios/${id}/duplicar`, 'POST');
  assert.equal(dup.status, 201);
  assert.equal(dup.dados.nome, 'Body Bebê (cópia)');

  await req('/anuncios', 'POST', { nome: 'Outro', custoProduto: 5, tags: ['Kit', 'Completo'] });
  assert.equal((await req('/anuncios?tags=kit')).dados.length, 3);
  assert.equal((await req('/anuncios?tags=kit&modoTag=somente')).dados.length, 2);
  assert.equal((await req('/anuncios?q=outro')).dados.length, 1);

  assert.equal((await req(`/anuncios/${id}`, 'DELETE')).status, 204);
  assert.equal((await req(`/anuncios/${id}`)).status, 404);
  assert.deepEqual((await req('/tags')).dados.map((x) => x.tag).sort(), ['Completo', 'Kit']);
});

test('validação: nome obrigatório e percentuais impossíveis', async (t) => {
  const { app, req } = await subir();
  t.after(() => app.close());
  assert.equal((await req('/anuncios', 'POST', { custoProduto: 10 })).status, 400);
  assert.equal((await req('/anuncios', 'POST', { nome: 'x', custoProduto: 10, margemPct: 90 })).status, 400);
});

test('taxas configuráveis', async (t) => {
  const { app, req } = await subir();
  t.after(() => app.close());
  await req('/config', 'PUT', { comissaoPct: 14, comissaoTeto: 100, taxaFixa: 4, taxaCpf: 3 });
  assert.equal((await req('/config')).dados.comissaoPct, 14);
  const a = await req('/anuncios', 'POST', { nome: 'x', tipoVendedor: 'cnpj', custoProduto: 10, modo: 'preco', precoVenda: 100 });
  assert.equal(a.dados.resultado.comissao, 14);
});
