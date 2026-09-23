import { calcular, normalizarEntrada } from './public/calc.js';

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

export function criarRepo(db) {
  const q = {
    lerTaxas: db.prepare("SELECT valor FROM config WHERE chave = 'taxas'"),
    gravarTaxas: db.prepare("UPDATE config SET valor = ? WHERE chave = 'taxas'"),
    listar: db.prepare('SELECT * FROM anuncios ORDER BY atualizado_em DESC, id DESC'),
    obter: db.prepare('SELECT * FROM anuncios WHERE id = ?'),
    tagsDe: db.prepare('SELECT tag FROM anuncio_tags WHERE anuncio_id = ? ORDER BY rowid'),
    todasTags: db.prepare('SELECT tag, COUNT(*) AS total FROM anuncio_tags GROUP BY tag ORDER BY total DESC, tag'),
    todasTagsPorAnuncio: db.prepare('SELECT anuncio_id, tag FROM anuncio_tags ORDER BY rowid'),
    apagarTags: db.prepare('DELETE FROM anuncio_tags WHERE anuncio_id = ?'),
    inserirTag: db.prepare('INSERT OR IGNORE INTO anuncio_tags (anuncio_id, tag) VALUES (?, ?)'),
    apagar: db.prepare('DELETE FROM anuncios WHERE id = ?'),
  };

  const COLUNAS = [
    'nome', 'comentario', 'imagem', 'tipo_vendedor', 'custo_produto', 'quantidade', 'imposto_pct',
    'custos_variaveis', 'extras', 'modo', 'margem_pct', 'preco_venda_input', 'lucro_desejado',
    'comissao_pct', 'comissao_teto', 'taxa_fixa', 'taxa_cpf', 'preco', 'comissao', 'imposto',
    'extras_total', 'total_custos', 'lucro', 'margem_real',
  ];
  const inserir = db.prepare(`INSERT INTO anuncios (${COLUNAS.join(',')}) VALUES (${COLUNAS.map((c) => ':' + c).join(',')})`);
  const atualizar = db.prepare(`UPDATE anuncios SET ${COLUNAS.map((c) => `${c} = :${c}`).join(', ')}, atualizado_em = datetime('now') WHERE id = :id`);

  function taxas() {
    return JSON.parse(q.lerTaxas.get().valor);
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
        nome,
        comentario: String(body?.comentario ?? '').slice(0, 2000),
        imagem,
        tipo_vendedor: entrada.tipoVendedor,
        custo_produto: entrada.custoProduto,
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
      q.gravarTaxas.run(JSON.stringify(t));
      return t;
    },

    listar({ busca = '', tags = [], modoTag = 'contem' } = {}) {
      const porAnuncio = new Map();
      for (const { anuncio_id, tag } of q.todasTagsPorAnuncio.all()) {
        if (!porAnuncio.has(anuncio_id)) porAnuncio.set(anuncio_id, []);
        porAnuncio.get(anuncio_id).push(tag);
      }
      const termo = busca.trim().toLowerCase();
      const filtro = tags.map((t) => t.toLowerCase());
      return q.listar.all()
        .map((l) => paraApi(l, porAnuncio.get(l.id) ?? []))
        .filter((a) => {
          if (termo && !(a.nome.toLowerCase().includes(termo) || a.comentario.toLowerCase().includes(termo))) return false;
          if (!filtro.length) return true;
          const minhas = a.tags.map((t) => t.toLowerCase());
          const temTodas = filtro.every((t) => minhas.includes(t));
          return modoTag === 'somente' ? temTodas && minhas.length === filtro.length : temTodas;
        });
    },

    tags: () => q.todasTags.all().map((r) => ({ tag: r.tag, total: r.total })),

    obter(id) {
      const l = q.obter.get(id);
      return l ? paraApi(l, q.tagsDe.all(id).map((r) => r.tag)) : null;
    },

    criar(body) {
      const { linha, tags } = montarLinha(body);
      const id = transacao(() => {
        const { lastInsertRowid } = inserir.run(linha);
        gravarTags(Number(lastInsertRowid), tags);
        return Number(lastInsertRowid);
      });
      return repo.obter(id);
    },

    atualizar(id, body) {
      if (!q.obter.get(id)) return null;
      const { linha, tags } = montarLinha(body);
      transacao(() => {
        atualizar.run({ ...linha, id });
        gravarTags(id, tags);
      });
      return repo.obter(id);
    },

    duplicar(id) {
      const a = repo.obter(id);
      if (!a) return null;
      return repo.criar({ ...a, nome: `${a.nome} (cópia)`.slice(0, 200) });
    },

    apagar: (id) => q.apagar.run(id).changes > 0,
  };
  return repo;
}
