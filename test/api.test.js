import test from 'node:test';
import assert from 'node:assert/strict';
import { abrirBanco } from '../db.js';
import { criarRepo, criarContas } from '../repo.js';
import { criarApp } from '../server.js';

async function subir(db = abrirBanco(':memory:')) {
  const app = criarApp({ repo: criarRepo(db), contas: criarContas(db) });
  await new Promise((ok) => app.listen(0, ok));
  const base = `http://127.0.0.1:${app.address().port}`;
  // Cada "navegador" guarda o próprio cookie de sessão.
  const navegador = () => {
    let cookie = '';
    const req = async (caminho, metodo = 'GET', corpo, extra = {}) => {
      const r = await fetch(base + caminho, {
        method: metodo, redirect: 'manual',
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...extra },
        body: corpo && JSON.stringify(corpo),
      });
      const set = r.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
      const tipo = r.headers.get('content-type') ?? '';
      return { status: r.status, headers: r.headers, dados: tipo.includes('json') && r.status !== 204 ? await r.json() : null };
    };
    return { req, api: (c, m, b) => req('/api' + c, m, b) };
  };
  return { app, navegador };
}

const conta = (n) => ({ nome: `Loja ${n}`, email: `loja${n}@exemplo.com`, senha: 'senhaforte123' });

test('sem login: API responde 401 e a página redireciona para o login', async (t) => {
  const { app, navegador } = await subir();
  t.after(() => app.close());
  const { req, api } = navegador();
  assert.equal((await api('/anuncios')).status, 401);
  assert.equal((await api('/anuncios', 'POST', { nome: 'x', custoProduto: 1 })).status, 401);
  const pagina = await req('/');
  assert.equal(pagina.status, 302);
  assert.equal(pagina.headers.get('location'), '/login.html');
  assert.equal((await req('/login.html')).status, 200);
});

test('cadastro, login, logout e senha errada', async (t) => {
  const { app, navegador } = await subir();
  t.after(() => app.close());
  const a = navegador();

  const cad = await a.api('/auth/cadastro', 'POST', conta(1));
  assert.equal(cad.status, 201);
  assert.equal(cad.dados.email, 'loja1@exemplo.com');
  assert.equal(cad.dados.senha_hash, undefined);
  assert.match(cad.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  assert.equal((await a.api('/auth/eu')).dados.nome, 'Loja 1');

  assert.equal((await navegador().api('/auth/cadastro', 'POST', { ...conta(1), email: 'LOJA1@exemplo.com' })).status, 409);
  assert.equal((await navegador().api('/auth/cadastro', 'POST', { ...conta(2), senha: 'curta' })).status, 400);
  assert.equal((await navegador().api('/auth/cadastro', 'POST', { ...conta(2), email: 'invalido' })).status, 400);

  assert.equal((await a.api('/auth/logout', 'POST')).status, 204);
  assert.equal((await a.api('/auth/eu')).status, 401);

  const b = navegador();
  const errada = await b.api('/auth/login', 'POST', { email: 'loja1@exemplo.com', senha: 'errada123' });
  assert.equal(errada.status, 401);
  const inexistente = await b.api('/auth/login', 'POST', { email: 'ninguem@exemplo.com', senha: 'qualquer123' });
  assert.equal(inexistente.dados.erro, errada.dados.erro); // não revela quais emails existem
  assert.equal((await b.api('/auth/login', 'POST', { email: ' Loja1@Exemplo.com ', senha: 'senhaforte123' })).status, 200);
  assert.equal((await b.api('/auth/eu')).dados.id, cad.dados.id);
});

test('cada loja só enxerga e altera os próprios anúncios', async (t) => {
  const { app, navegador } = await subir();
  t.after(() => app.close());
  const a = navegador(); const b = navegador();
  await a.api('/auth/cadastro', 'POST', conta(1));
  await b.api('/auth/cadastro', 'POST', conta(2));

  const criado = await a.api('/anuncios', 'POST', { nome: 'Body Bebê', custoProduto: 10, margemPct: 10, tags: ['Kit'] });
  assert.equal(criado.status, 201);
  const id = criado.dados.id;

  assert.equal((await b.api('/anuncios')).dados.length, 0);
  assert.equal((await b.api('/tags')).dados.length, 0);
  assert.equal((await b.api(`/anuncios/${id}`)).status, 404);
  assert.equal((await b.api(`/anuncios/${id}`, 'PUT', { nome: 'roubado', custoProduto: 1 })).status, 404);
  assert.equal((await b.api(`/anuncios/${id}/duplicar`, 'POST')).status, 404);
  assert.equal((await b.api(`/anuncios/${id}`, 'DELETE')).status, 404);
  assert.equal((await a.api(`/anuncios/${id}`)).dados.nome, 'Body Bebê');

  // Taxas também são por loja
  await b.api('/config', 'PUT', { comissaoPct: 14, comissaoTeto: 100, taxaFixa: 4, taxaCpf: 3 });
  assert.equal((await a.api('/config')).dados.comissaoPct, 20);
  assert.equal((await b.api('/config')).dados.comissaoPct, 14);
});

test('escrita sem JSON é recusada (proteção contra CSRF)', async (t) => {
  const { app, navegador } = await subir();
  t.after(() => app.close());
  const a = navegador();
  await a.api('/auth/cadastro', 'POST', conta(1));
  const r = await a.req('/api/anuncios', 'POST', { nome: 'x', custoProduto: 1 }, { 'Content-Type': 'text/plain' });
  assert.equal(r.status, 415);
});

test('CRUD de anúncios com recálculo no servidor', async (t) => {
  const { app, navegador } = await subir();
  t.after(() => app.close());
  const { api } = navegador();
  await api('/auth/cadastro', 'POST', conta(1));

  // Cliente manda um "preco" falso; o servidor ignora e recalcula.
  const criado = await api('/anuncios', 'POST', {
    nome: 'Body Bebê', tipoVendedor: 'cpf', custoProduto: 10, modo: 'margem', margemPct: 10,
    tags: ['Ranqueamento', 'ranqueamento', 'Kit'], comentario: 'teste', preco: 1, resultado: { preco: 1 },
  });
  assert.equal(criado.status, 201);
  assert.equal(criado.dados.resultado.preco, 25);
  assert.deepEqual(criado.dados.tags, ['Ranqueamento', 'Kit']);
  const id = criado.dados.id;

  const editado = await api(`/anuncios/${id}`, 'PUT', { ...criado.dados, tipoVendedor: 'cnpj', tags: ['Kit'] });
  assert.equal(editado.dados.resultado.preco, 20.72); // (10 + 4.5) / (1 - 0.2 - 0.1) = 20.714…
  assert.deepEqual(editado.dados.tags, ['Kit']);

  const dup = await api(`/anuncios/${id}/duplicar`, 'POST');
  assert.equal(dup.status, 201);
  assert.equal(dup.dados.nome, 'Body Bebê (cópia)');

  await api('/anuncios', 'POST', { nome: 'Outro', custoProduto: 5, tags: ['Kit', 'Completo'] });
  assert.equal((await api('/anuncios?tags=kit')).dados.length, 3);
  assert.equal((await api('/anuncios?tags=kit&modoTag=somente')).dados.length, 2);
  assert.equal((await api('/anuncios?q=outro')).dados.length, 1);

  assert.equal((await api(`/anuncios/${id}`, 'DELETE')).status, 204);
  assert.equal((await api(`/anuncios/${id}`)).status, 404);
  assert.deepEqual((await api('/tags')).dados.map((x) => x.tag).sort(), ['Completo', 'Kit']);

  const kit = await api('/anuncios', 'POST', { nome: 'Kit', produtos: [{ custo: 5, quantidade: 2 }, { custo: 4, quantidade: 1 }], modo: 'preco', precoVenda: 40 });
  assert.deepEqual((await api(`/anuncios/${kit.dados.id}`)).dados.produtos, [{ custo: 5, quantidade: 2 }, { custo: 4, quantidade: 1 }]);
  assert.equal(kit.dados.resultado.totalCustos, 14 + 8 + 4.5 + 3);

  assert.equal((await api('/anuncios', 'POST', { custoProduto: 10 })).status, 400);
  assert.equal((await api('/anuncios', 'POST', { nome: 'x', custoProduto: 10, margemPct: 90 })).status, 400);
});

test('limita tentativas de login', async (t) => {
  const { app, navegador } = await subir();
  t.after(() => app.close());
  await navegador().api('/auth/cadastro', 'POST', conta(1));
  const b = navegador();
  let ultimo;
  for (let i = 0; i < 9; i++) ultimo = await b.api('/auth/login', 'POST', { email: 'loja1@exemplo.com', senha: 'errada123' });
  assert.equal(ultimo.status, 429);
  // Nem a senha certa entra enquanto estiver bloqueado.
  assert.equal((await b.api('/auth/login', 'POST', { email: 'loja1@exemplo.com', senha: 'senhaforte123' })).status, 429);
});

test('troca de senha derruba sessões antigas', async (t) => {
  const db = abrirBanco(':memory:');
  const { app, navegador } = await subir(db);
  t.after(() => app.close());
  const a = navegador();
  await a.api('/auth/cadastro', 'POST', conta(1));
  assert.equal(await criarContas(db).trocarSenha('loja1@exemplo.com', 'novasenha456'), true);
  assert.equal((await a.api('/auth/eu')).status, 401);
  assert.equal((await navegador().api('/auth/login', 'POST', { email: 'loja1@exemplo.com', senha: 'novasenha456' })).status, 200);
});

test('banco antigo sem contas: anúncios são adotados pela primeira loja', async (t) => {
  const { DatabaseSync } = await import('node:sqlite');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'precif-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const caminho = join(dir, 'antigo.db');
  // Esquema da versão anterior (sem loja_id)
  const antigo = new DatabaseSync(caminho);
  antigo.exec(`CREATE TABLE anuncios (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, comentario TEXT NOT NULL DEFAULT '', imagem TEXT,
    tipo_vendedor TEXT NOT NULL, custo_produto REAL NOT NULL, quantidade INTEGER NOT NULL, imposto_pct REAL NOT NULL, custos_variaveis REAL NOT NULL,
    extras TEXT NOT NULL DEFAULT '[]', modo TEXT NOT NULL, margem_pct REAL NOT NULL, preco_venda_input REAL NOT NULL, lucro_desejado REAL NOT NULL,
    comissao_pct REAL NOT NULL, comissao_teto REAL NOT NULL, taxa_fixa REAL NOT NULL, taxa_cpf REAL NOT NULL, preco REAL NOT NULL, comissao REAL NOT NULL,
    imposto REAL NOT NULL, extras_total REAL NOT NULL, total_custos REAL NOT NULL, lucro REAL NOT NULL, margem_real REAL NOT NULL,
    criado_em TEXT NOT NULL DEFAULT (datetime('now')), atualizado_em TEXT NOT NULL DEFAULT (datetime('now')));
    INSERT INTO anuncios (nome, tipo_vendedor, custo_produto, quantidade, imposto_pct, custos_variaveis, modo, margem_pct, preco_venda_input, lucro_desejado,
      comissao_pct, comissao_teto, taxa_fixa, taxa_cpf, preco, comissao, imposto, extras_total, total_custos, lucro, margem_real)
    VALUES ('Antigo', 'cpf', 10, 1, 0, 0, 'margem', 10, 0, 0, 20, 100, 4, 3, 24.29, 4.86, 0, 0, 21.86, 2.43, 10);`);
  antigo.close();

  const { app, navegador } = await subir(abrirBanco(caminho));
  t.after(() => app.close());
  const a = navegador(); const b = navegador();
  await a.api('/auth/cadastro', 'POST', conta(1));
  await b.api('/auth/cadastro', 'POST', conta(2));
  assert.deepEqual((await a.api('/anuncios')).dados.map((x) => x.nome), ['Antigo']);
  assert.equal((await b.api('/anuncios')).dados.length, 0);
});
