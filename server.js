import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirBanco } from './db.js';
import { criarRepo, criarContas, ErroValidacao, ErroConflito } from './repo.js';
import { criarLimitador, DURACAO_SESSAO_DIAS } from './auth.js';

const RAIZ = fileURLToPath(new URL('.', import.meta.url));
const PUBLICO = join(RAIZ, 'public');
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
const LIMITE_CORPO = 1_000_000;
const COOKIE = 'sessao';
// Páginas que exigem login; o resto (login.html, css, js) é público.
const PAGINAS_PROTEGIDAS = new Set(['/', '/index.html']);

export function criarApp({ repo, contas }) {
  const limitador = criarLimitador();

  const json = (res, status, dados, cabecalhos = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cabecalhos });
    res.end(dados === undefined ? '' : JSON.stringify(dados));
  };

  const lerCookie = (req) => {
    for (const parte of (req.headers.cookie ?? '').split(';')) {
      const [k, ...v] = parte.trim().split('=');
      if (k === COOKIE) return decodeURIComponent(v.join('='));
    }
    return null;
  };
  const ehHttps = (req) => req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
  const cookieSessao = (req, token, maxAge) =>
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${ehHttps(req) ? '; Secure' : ''}`;

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

  async function rotasAuth(req, res, acao) {
    if (req.method === 'GET' && acao === 'eu') {
      const loja = contas.lojaDaSessao(lerCookie(req));
      return loja ? json(res, 200, loja) : json(res, 401, { erro: 'Não autenticado.' });
    }
    if (req.method !== 'POST') return json(res, 404, { erro: 'Rota não encontrada.' });

    if (acao === 'cadastro') {
      const corpo = await lerCorpo(req);
      const loja = await contas.cadastrar(corpo);
      const token = contas.abrirSessao(loja.id);
      return json(res, 201, loja, { 'Set-Cookie': cookieSessao(req, token, DURACAO_SESSAO_DIAS * 86400) });
    }
    if (acao === 'login') {
      const { email, senha } = await lerCorpo(req);
      const chave = `${req.socket.remoteAddress}|${String(email ?? '').trim().toLowerCase()}`;
      if (limitador.bloqueado(chave)) return json(res, 429, { erro: 'Muitas tentativas. Espere 15 minutos e tente de novo.' });
      const loja = await contas.autenticar(email, senha);
      if (!loja) { limitador.falhou(chave); return json(res, 401, { erro: 'Email ou senha incorretos.' }); }
      limitador.sucesso(chave);
      const token = contas.abrirSessao(loja.id);
      return json(res, 200, loja, { 'Set-Cookie': cookieSessao(req, token, DURACAO_SESSAO_DIAS * 86400) });
    }
    if (acao === 'logout') {
      contas.fecharSessao(lerCookie(req));
      return json(res, 204, undefined, { 'Set-Cookie': cookieSessao(req, '', 0) });
    }
    return json(res, 404, { erro: 'Rota não encontrada.' });
  }

  async function api(req, res, url) {
    // Toda escrita exige JSON: formulários de outros sites não conseguem enviar
    // esse Content-Type sem preflight, o que bloqueia CSRF junto com SameSite.
    if (req.method !== 'GET' && !String(req.headers['content-type'] ?? '').startsWith('application/json')) {
      return json(res, 415, { erro: 'Envie application/json.' });
    }
    const partes = url.pathname.split('/').filter(Boolean).slice(1); // remove "api"
    const [recurso, idTxt, acao] = partes;
    if (recurso === 'auth') return rotasAuth(req, res, idTxt);

    const loja = contas.lojaDaSessao(lerCookie(req));
    if (!loja) return json(res, 401, { erro: 'Faça login para continuar.' });
    const dados = repo.daLoja(loja.id);

    const id = idTxt !== undefined ? Number(idTxt) : undefined;
    if (id !== undefined && !Number.isInteger(id)) return json(res, 400, { erro: 'ID inválido.' });
    const m = req.method;
    const naoAchou = () => json(res, 404, { erro: 'Anúncio não encontrado.' });

    if (recurso === 'config' && !idTxt) {
      if (m === 'GET') return json(res, 200, dados.taxas());
      if (m === 'PUT') return json(res, 200, dados.salvarTaxas(await lerCorpo(req)));
    }
    if (recurso === 'tags' && !idTxt && m === 'GET') return json(res, 200, dados.tags());
    if (recurso === 'anuncios') {
      if (id === undefined) {
        if (m === 'GET') {
          const p = url.searchParams;
          return json(res, 200, dados.listar({
            busca: p.get('q') ?? '',
            tags: (p.get('tags') ?? '').split(',').map((t) => t.trim()).filter(Boolean),
            modoTag: p.get('modoTag') === 'somente' ? 'somente' : 'contem',
          }));
        }
        if (m === 'POST') return json(res, 201, dados.criar(await lerCorpo(req)));
      } else if (acao === 'duplicar' && m === 'POST') {
        const a = dados.duplicar(id);
        return a ? json(res, 201, a) : naoAchou();
      } else if (!acao) {
        if (m === 'GET') { const a = dados.obter(id); return a ? json(res, 200, a) : naoAchou(); }
        if (m === 'PUT') { const a = dados.atualizar(id, await lerCorpo(req)); return a ? json(res, 200, a) : naoAchou(); }
        if (m === 'DELETE') return dados.apagar(id) ? json(res, 204) : naoAchou();
      }
    }
    return json(res, 404, { erro: 'Rota não encontrada.' });
  }

  async function estatico(req, res, pathname) {
    const logado = () => !!contas.lojaDaSessao(lerCookie(req));
    if (PAGINAS_PROTEGIDAS.has(pathname) && !logado()) {
      res.writeHead(302, { Location: '/login.html', 'Cache-Control': 'no-store' }); return res.end();
    }
    if (pathname === '/login.html' && logado()) {
      res.writeHead(302, { Location: '/', 'Cache-Control': 'no-store' }); return res.end();
    }
    const rel = normalize(pathname === '/' ? '/index.html' : pathname).replace(/^([/\\])+/, '');
    const arquivo = join(PUBLICO, rel);
    if (!arquivo.startsWith(PUBLICO)) { res.writeHead(403); return res.end(); }
    try {
      const dadosArq = await readFile(arquivo);
      const ext = extname(arquivo);
      res.writeHead(200, {
        'Content-Type': TIPOS[ext] ?? 'application/octet-stream',
        ...(ext === '.html' ? { 'Cache-Control': 'no-store' } : {}),
      });
      res.end(dadosArq);
    } catch {
      res.writeHead(404); res.end('Não encontrado');
    }
  }

  return createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
      return await estatico(req, res, decodeURIComponent(url.pathname));
    } catch (err) {
      if (err instanceof ErroValidacao) return json(res, 400, { erro: err.message });
      if (err instanceof ErroConflito) return json(res, 409, { erro: err.message });
      console.error(err);
      return json(res, 500, { erro: 'Erro interno.' });
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const porta = Number(process.env.PORT) || 3000;
  const banco = process.env.DB_PATH || join(RAIZ, 'data', 'precificador.db');
  const db = abrirBanco(banco);
  criarApp({ repo: criarRepo(db), contas: criarContas(db) }).listen(porta, () => {
    console.log(`Precificador rodando em http://localhost:${porta}  (banco: ${banco})`);
  });
}
