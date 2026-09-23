import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirBanco } from './db.js';
import { criarRepo, ErroValidacao } from './repo.js';

const RAIZ = fileURLToPath(new URL('.', import.meta.url));
const PUBLICO = join(RAIZ, 'public');
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
const LIMITE_CORPO = 1_000_000;

export function criarApp(repo) {
  const json = (res, status, dados) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(dados === undefined ? '' : JSON.stringify(dados));
  };

  const lerCorpo = (req) => new Promise((ok, falha) => {
    let tam = 0; const partes = [];
    req.on('data', (c) => {
      tam += c.length;
      if (tam > LIMITE_CORPO) { falha(new ErroValidacao('Requisição grande demais.')); req.destroy(); return; }
      partes.push(c);
    });
    req.on('end', () => {
      try { ok(partes.length ? JSON.parse(Buffer.concat(partes).toString('utf8')) : {}); } catch { falha(new ErroValidacao('JSON inválido.')); }
    });
    req.on('error', falha);
  });

  async function api(req, res, url) {
    const partes = url.pathname.split('/').filter(Boolean).slice(1); // remove "api"
    const [recurso, idTxt, acao] = partes;
    const id = idTxt !== undefined ? Number(idTxt) : undefined;
    if (id !== undefined && !Number.isInteger(id)) return json(res, 400, { erro: 'ID inválido.' });
    const m = req.method;

    if (recurso === 'config' && !idTxt) {
      if (m === 'GET') return json(res, 200, repo.taxas());
      if (m === 'PUT') return json(res, 200, repo.salvarTaxas(await lerCorpo(req)));
    }
    if (recurso === 'tags' && !idTxt && m === 'GET') return json(res, 200, repo.tags());
    if (recurso === 'anuncios') {
      if (id === undefined) {
        if (m === 'GET') {
          const p = url.searchParams;
          return json(res, 200, repo.listar({
            busca: p.get('q') ?? '',
            tags: (p.get('tags') ?? '').split(',').map((t) => t.trim()).filter(Boolean),
            modoTag: p.get('modoTag') === 'somente' ? 'somente' : 'contem',
          }));
        }
        if (m === 'POST') return json(res, 201, repo.criar(await lerCorpo(req)));
      } else if (acao === 'duplicar' && m === 'POST') {
        const a = repo.duplicar(id);
        return a ? json(res, 201, a) : json(res, 404, { erro: 'Anúncio não encontrado.' });
      } else if (!acao) {
        if (m === 'GET') { const a = repo.obter(id); return a ? json(res, 200, a) : json(res, 404, { erro: 'Anúncio não encontrado.' }); }
        if (m === 'PUT') { const a = repo.atualizar(id, await lerCorpo(req)); return a ? json(res, 200, a) : json(res, 404, { erro: 'Anúncio não encontrado.' }); }
        if (m === 'DELETE') return repo.apagar(id) ? json(res, 204) : json(res, 404, { erro: 'Anúncio não encontrado.' });
      }
    }
    return json(res, 404, { erro: 'Rota não encontrada.' });
  }

  async function estatico(res, pathname) {
    const rel = normalize(pathname === '/' ? '/index.html' : pathname).replace(/^([/\\])+/, '');
    const arquivo = join(PUBLICO, rel);
    if (!arquivo.startsWith(PUBLICO)) { res.writeHead(403); return res.end(); }
    try {
      const dados = await readFile(arquivo);
      res.writeHead(200, { 'Content-Type': TIPOS[extname(arquivo)] ?? 'application/octet-stream' });
      res.end(dados);
    } catch {
      res.writeHead(404); res.end('Não encontrado');
    }
  }

  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
      return await estatico(res, decodeURIComponent(url.pathname));
    } catch (err) {
      if (err instanceof ErroValidacao) return json(res, 400, { erro: err.message });
      console.error(err);
      return json(res, 500, { erro: 'Erro interno.' });
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const porta = Number(process.env.PORT) || 3000;
  const banco = process.env.DB_PATH || join(RAIZ, 'data', 'precificador.db');
  criarApp(criarRepo(abrirBanco(banco))).listen(porta, () => {
    console.log(`Precificador rodando em http://localhost:${porta}  (banco: ${banco})`);
  });
}
