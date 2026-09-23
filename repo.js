import { calcular, normalizarEntrada, TAXAS_PADRAO } from './public/calc.js';
import { gerarHashSenha, conferirSenha, novoToken, hashToken, HASH_FALSO, DURACAO_SESSAO_DIAS } from './auth.js';

const MAX_IMAGEM = 400_000; // ~400 KB em data URL

function limparTags(tags) {
  const vistos = new Map();
  for (const t of Array.isArray(tags) ? tags : []) {
    const s = String(t ?? '').trim().slice(0, 30);
    if (s && !vistos.has(s.toLowerCase())) vistos.set(s.toLowerCase(), s);
  }
  return [...vistos.values()].slice(0, 20);
}

export class ErroValidacao extends Error {}
export class ErroConflito extends Error {}

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const SENHA_MIN = 8;

function validarSenha(senha) {
  if (typeof senha !== 'string' || senha.length < SENHA_MIN) throw new ErroValidacao(`A senha precisa ter pelo menos ${SENHA_MIN} caracteres.`);
  if (senha.length > 200) throw new ErroValidacao('Senha longa demais.');
}

// Contas das lojas e sessões de login.
export function criarContas(db) {
  const q = {
    inserir: db.prepare('INSERT INTO lojas (nome, email, senha_hash, taxas) VALUES (?, ?, ?, ?)'),
    porEmail: db.prepare('SELECT * FROM lojas WHERE email = ?'),
    porId: db.prepare('SELECT id, nome, email, criado_em FROM lojas WHERE id = ?'),
    total: db.prepare('SELECT COUNT(*) AS n FROM lojas'),
    adotarOrfaos: db.prepare('UPDATE anuncios SET loja_id = ? WHERE loja_id IS NULL'),
    trocarSenha: db.prepare('UPDATE lojas SET senha_hash = ? WHERE id = ?'),
    criarSessao: db.prepare('INSERT INTO sessoes (token_hash, loja_id, expira_em) VALUES (?, ?, ?)'),
    sessao: db.prepare(`SELECT l.id, l.nome, l.email FROM sessoes s JOIN lojas l ON l.id = s.loja_id
                        WHERE s.token_hash = ? AND s.expira_em > datetime('now')`),
    apagarSessao: db.prepare('DELETE FROM sessoes WHERE token_hash = ?'),
    apagarSessoesDaLoja: db.prepare('DELETE FROM sessoes WHERE loja_id = ?'),
    limparExpiradas: db.prepare("DELETE FROM sessoes WHERE expira_em <= datetime('now')"),
  };
  const publica = (l) => ({ id: l.id, nome: l.nome, email: l.email });

  return {
    async cadastrar({ nome, email, senha } = {}) {
      nome = String(nome ?? '').trim().slice(0, 80);
      email = String(email ?? '').trim().toLowerCase();
      if (!nome) throw new ErroValidacao('Informe o nome da loja.');
      if (!EMAIL_OK.test(email) || email.length > 200) throw new ErroValidacao('Informe um email válido.');
      validarSenha(senha);
      if (q.porEmail.get(email)) throw new ErroConflito('Já existe uma conta com esse email.');
      const hash = await gerarHashSenha(senha);
      try {
        db.exec('BEGIN');
        const primeira = q.total.get().n === 0;
        const { lastInsertRowid } = q.inserir.run(nome, email, hash, JSON.stringify(TAXAS_PADRAO));
        const id = Number(lastInsertRowid);
        if (primeira) q.adotarOrfaos.run(id);
        db.exec('COMMIT');
        return publica(q.porId.get(id));
      } catch (err) {
        db.exec('ROLLBACK');
        if (String(err.message).includes('UNIQUE')) throw new ErroConflito('Já existe uma conta com esse email.');
        throw err;
      }
    },

    // Retorna a loja ou null. Sempre roda o scrypt, exista o email ou não.
    async autenticar(email, senha) {
      const l = q.porEmail.get(String(email ?? '').trim().toLowerCase());
      const ok = await conferirSenha(String(senha ?? ''), l?.senha_hash ?? HASH_FALSO);
      return l && ok ? publica(l) : null;
    },

    abrirSessao(lojaId) {
      q.limparExpiradas.run();
      const token = novoToken();
      const expira = new Date(Date.now() + DURACAO_SESSAO_DIAS * 864e5).toISOString().replace('T', ' ').slice(0, 19);
      q.criarSessao.run(hashToken(token), lojaId, expira);
      return token;
    },
    lojaDaSessao: (token) => (token ? q.sessao.get(hashToken(token)) ?? null : null),
    fecharSessao: (token) => { if (token) q.apagarSessao.run(hashToken(token)); },

    async trocarSenha(email, novaSenha) {
      validarSenha(novaSenha);
      const l = q.porEmail.get(String(email).trim().toLowerCase());
      if (!l) return false;
      q.trocarSenha.run(await gerarHashSenha(novaSenha), l.id);
      q.apagarSessoesDaLoja.run(l.id); // derruba quem estava logado com a senha antiga
      return true;
    },
  };
}

export function criarRepo(db) {
  // Repositório preso a uma loja: nenhuma consulta enxerga dados de outra.
  return { daLoja: (lojaId) => criarRepoLoja(db, lojaId) };
}

const cacheConsultas = new WeakMap();
function consultas(db) {
  if (cacheConsultas.has(db)) return cacheConsultas.get(db);
  const q = {
    lerTaxas: db.prepare('SELECT taxas FROM lojas WHERE id = ?'),
    gravarTaxas: db.prepare('UPDATE lojas SET taxas = ? WHERE id = ?'),
    listar: db.prepare('SELECT * FROM anuncios WHERE loja_id = ? ORDER BY atualizado_em DESC, id DESC'),
    obter: db.prepare('SELECT * FROM anuncios WHERE id = ? AND loja_id = ?'),
    tagsDe: db.prepare('SELECT tag FROM anuncio_tags WHERE anuncio_id = ? ORDER BY rowid'),
    todasTags: db.prepare(`SELECT t.tag, COUNT(*) AS total FROM anuncio_tags t JOIN anuncios a ON a.id = t.anuncio_id
                           WHERE a.loja_id = ? GROUP BY t.tag ORDER BY total DESC, t.tag`),
    todasTagsPorAnuncio: db.prepare(`SELECT t.anuncio_id, t.tag FROM anuncio_tags t JOIN anuncios a ON a.id = t.anuncio_id
                                     WHERE a.loja_id = ? ORDER BY t.rowid`),
    apagarTags: db.prepare('DELETE FROM anuncio_tags WHERE anuncio_id = ?'),
    inserirTag: db.prepare('INSERT OR IGNORE INTO anuncio_tags (anuncio_id, tag) VALUES (?, ?)'),
    apagar: db.prepare('DELETE FROM anuncios WHERE id = ? AND loja_id = ?'),
  };

  const COLUNAS = [
    'loja_id', 'nome', 'comentario', 'imagem', 'tipo_vendedor', 'custo_produto', 'produtos', 'quantidade', 'imposto_pct',
    'custos_variaveis', 'extras', 'modo', 'margem_pct', 'preco_venda_input', 'lucro_desejado',
    'comissao_pct', 'comissao_teto', 'taxa_fixa', 'taxa_cpf', 'preco', 'comissao', 'imposto',
    'extras_total', 'total_custos', 'lucro', 'margem_real',
  ];
  q.inserir = db.prepare(`INSERT INTO anuncios (${COLUNAS.join(',')}) VALUES (${COLUNAS.map((c) => ':' + c).join(',')})`);
  q.atualizar = db.prepare(`UPDATE anuncios SET ${COLUNAS.map((c) => `${c} = :${c}`).join(', ')}, atualizado_em = datetime('now') WHERE id = :id AND loja_id = :loja_id`);
  cacheConsultas.set(db, q);
  return q;
}

function criarRepoLoja(db, lojaId) {
  const q = consultas(db);

  function taxas() {
    return JSON.parse(q.lerTaxas.get(lojaId)?.taxas ?? JSON.stringify(TAXAS_PADRAO));
  }

  function transacao(fn) {
    db.exec('BEGIN');
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (err) { db.exec('ROLLBACK'); throw err; }
  }

  // Converte o payload do cliente em uma linha do banco, recalculando tudo.
  function montarLinha(body) {
    const nome = String(body?.nome ?? '').trim().slice(0, 200);
    if (!nome) throw new ErroValidacao('Dê um nome ao anúncio antes de salvar.');
    const imagem = body?.imagem ? String(body.imagem) : null;
    if (imagem && (!imagem.startsWith('data:image/') || imagem.length > MAX_IMAGEM)) {
      throw new ErroValidacao('Imagem inválida ou grande demais.');
    }
    // Usa as taxas enviadas (edição de anúncio antigo) ou as vigentes.
    const entrada = normalizarEntrada({ ...body, taxas: body?.taxas ?? taxas() });
    const r = calcular(entrada);
    if (r.erro) throw new ErroValidacao(r.erro);
    if (r.preco <= 0) throw new ErroValidacao('Preencha os custos para gerar um preço antes de salvar.');
    return {
      linha: {
        loja_id: lojaId,
        nome,
        comentario: String(body?.comentario ?? '').slice(0, 2000),
        imagem,
        tipo_vendedor: entrada.tipoVendedor,
        custo_produto: entrada.custoProduto,
        produtos: JSON.stringify(entrada.produtos),
        quantidade: entrada.quantidade,
        imposto_pct: entrada.impostoPct,
        custos_variaveis: entrada.custosVariaveis,
        extras: JSON.stringify(entrada.extras),
        modo: entrada.modo,
        margem_pct: entrada.margemPct,
        preco_venda_input: entrada.precoVenda,
        lucro_desejado: entrada.lucroDesejado,
        comissao_pct: entrada.taxas.comissaoPct,
        comissao_teto: entrada.taxas.comissaoTeto,
        taxa_fixa: entrada.taxas.taxaFixa,
        taxa_cpf: entrada.taxas.taxaCpf,
        preco: r.preco,
        comissao: r.comissao,
        imposto: r.imposto,
        extras_total: r.extrasTotal,
        total_custos: r.totalCustos,
        lucro: r.lucro,
        margem_real: r.margemReal,
      },
      tags: limparTags(body?.tags),
    };
  }

  function paraApi(l, tags) {
    return {
      id: l.id,
      nome: l.nome,
      comentario: l.comentario,
      imagem: l.imagem,
      tags,
      tipoVendedor: l.tipo_vendedor,
      custoProduto: l.custo_produto,
      produtos: (() => { const p = JSON.parse(l.produtos || '[]'); return p.length ? p : [{ custo: l.custo_produto, quantidade: l.quantidade }]; })(),
      quantidade: l.quantidade,
      impostoPct: l.imposto_pct,
      custosVariaveis: l.custos_variaveis,
      extras: JSON.parse(l.extras),
      modo: l.modo,
      margemPct: l.margem_pct,
      precoVenda: l.preco_venda_input,
      lucroDesejado: l.lucro_desejado,
      taxas: { comissaoPct: l.comissao_pct, comissaoTeto: l.comissao_teto, taxaFixa: l.taxa_fixa, taxaCpf: l.taxa_cpf },
      resultado: {
        preco: l.preco, comissao: l.comissao, imposto: l.imposto, extrasTotal: l.extras_total,
        totalCustos: l.total_custos, lucro: l.lucro, margemReal: l.margem_real,
      },
      criadoEm: l.criado_em,
      atualizadoEm: l.atualizado_em,
    };
  }

  function gravarTags(id, tags) {
    q.apagarTags.run(id);
    for (const t of tags) q.inserirTag.run(id, t);
  }

  const repo = {
    taxas,
    salvarTaxas(novas) {
      const t = normalizarEntrada({ taxas: novas }).taxas;
      if (t.comissaoPct >= 100) throw new ErroValidacao('Comissão precisa ser menor que 100%.');
      q.gravarTaxas.run(JSON.stringify(t), lojaId);
      return t;
    },

    listar({ busca = '', tags = [], modoTag = 'contem' } = {}) {
      const porAnuncio = new Map();
      for (const { anuncio_id, tag } of q.todasTagsPorAnuncio.all(lojaId)) {
        if (!porAnuncio.has(anuncio_id)) porAnuncio.set(anuncio_id, []);
        porAnuncio.get(anuncio_id).push(tag);
      }
      const termo = busca.trim().toLowerCase();
      const filtro = tags.map((t) => t.toLowerCase());
      return q.listar.all(lojaId)
        .map((l) => paraApi(l, porAnuncio.get(l.id) ?? []))
        .filter((a) => {
          if (termo && !(a.nome.toLowerCase().includes(termo) || a.comentario.toLowerCase().includes(termo))) return false;
          if (!filtro.length) return true;
          const minhas = a.tags.map((t) => t.toLowerCase());
          const temTodas = filtro.every((t) => minhas.includes(t));
          return modoTag === 'somente' ? temTodas && minhas.length === filtro.length : temTodas;
        });
    },

    tags: () => q.todasTags.all(lojaId).map((r) => ({ tag: r.tag, total: r.total })),

    obter(id) {
      const l = q.obter.get(id, lojaId);
      return l ? paraApi(l, q.tagsDe.all(id).map((r) => r.tag)) : null;
    },

    criar(body) {
      const { linha, tags } = montarLinha(body);
      const id = transacao(() => {
        const { lastInsertRowid } = q.inserir.run(linha);
        gravarTags(Number(lastInsertRowid), tags);
        return Number(lastInsertRowid);
      });
      return repo.obter(id);
    },

    atualizar(id, body) {
      if (!q.obter.get(id, lojaId)) return null;
      const { linha, tags } = montarLinha(body);
      transacao(() => {
        q.atualizar.run({ ...linha, id });
        gravarTags(id, tags);
      });
      return repo.obter(id);
    },

    duplicar(id) {
      const a = repo.obter(id);
      if (!a) return null;
      return repo.criar({ ...a, nome: `${a.nome} (cópia)`.slice(0, 200) });
    },

    apagar: (id) => q.apagar.run(id, lojaId).changes > 0,
  };
  return repo;
}
