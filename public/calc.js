// Motor de cálculo compartilhado entre o navegador e o servidor.
// O servidor sempre recalcula antes de salvar, então o que vai para o banco
// é exatamente o que esta função produz — nunca um número vindo do cliente.

export const TAXAS_PADRAO = Object.freeze({
  comissaoPct: 20,   // comissão + programa de frete (percentual sobre o preço)
  comissaoTeto: 100, // teto da comissão por item, em R$
  taxaFixa: 4.5,     // taxa fixa por item vendido, em R$
  taxaCpf: 3,        // adicional por item para vendedor CPF, em R$
});

const num = (v) => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
const ceil2 = (v) => Math.ceil(r2(v * 100) - 1e-9) / 100;

const qtdValida = (v) => Math.min(999, Math.max(1, Math.floor(num(v) || 1)));

export function normalizarEntrada(e = {}) {
  const taxas = { ...TAXAS_PADRAO, ...(e.taxas || {}) };
  for (const k of Object.keys(TAXAS_PADRAO)) taxas[k] = Math.max(0, num(taxas[k]));
  // Kits: vários produtos, cada um com custo e quantidade. Sem a lista,
  // usa o formato antigo (um custo só) para os anúncios já salvos.
  const listaProdutos = Array.isArray(e.produtos) && e.produtos.length
    ? e.produtos
    : [{ custo: e.custoProduto, quantidade: e.quantidade }];
  const produtos = listaProdutos.slice(0, 20).map((p) => ({
    custo: Math.max(0, num(p?.custo)),
    quantidade: qtdValida(p?.quantidade),
  }));
  return {
    tipoVendedor: e.tipoVendedor === 'cnpj' ? 'cnpj' : 'cpf',
    produtos,
    // Espelho do primeiro produto, para quem ainda lê os campos antigos.
    custoProduto: produtos[0].custo,
    quantidade: produtos[0].quantidade,
    impostoPct: Math.max(0, num(e.impostoPct)),
    custosVariaveis: Math.max(0, num(e.custosVariaveis)),
    extras: (Array.isArray(e.extras) ? e.extras : [])
      .map((x) => ({
        nome: String(x?.nome ?? '').trim().slice(0, 60),
        tipo: x?.tipo === 'percentual' ? 'percentual' : 'fixo',
        valor: Math.max(0, num(x?.valor)),
      }))
      .filter((x) => x.nome || x.valor > 0),
    modo: ['margem', 'preco', 'lucro'].includes(e.modo) ? e.modo : 'margem',
    margemPct: num(e.margemPct),
    precoVenda: Math.max(0, num(e.precoVenda)),
    lucroDesejado: num(e.lucroDesejado),
    taxas,
  };
}

const somaProdutos = (e) => r2(e.produtos.reduce((s, p) => s + p.custo * p.quantidade, 0));

// Detalha custos e lucro para um preço de venda já definido.
export function detalharPreco(preco, e) {
  const { taxas } = e;
  const custoProdutoTotal = somaProdutos(e);
  const comissaoBruta = preco * taxas.comissaoPct / 100;
  const comissaoLimitada = taxas.comissaoTeto > 0 && comissaoBruta > taxas.comissaoTeto;
  const comissao = r2(comissaoLimitada ? taxas.comissaoTeto : comissaoBruta);
  const imposto = r2(preco * e.impostoPct / 100);
  const extras = e.extras.map((x) => ({
    ...x,
    custo: r2(x.tipo === 'percentual' ? preco * x.valor / 100 : x.valor),
  }));
  const extrasTotal = r2(extras.reduce((s, x) => s + x.custo, 0));
  // Taxas por item aparecem sempre, mesmo antes de haver preço: toda venda paga.
  const taxaFixa = taxas.taxaFixa;
  const taxaCpf = e.tipoVendedor === 'cpf' ? taxas.taxaCpf : 0;
  const totalCustos = r2(custoProdutoTotal + e.custosVariaveis + extrasTotal + comissao + imposto + taxaFixa + taxaCpf);
  // Sem preço ainda não há venda, então não mostramos prejuízo.
  const lucro = preco > 0 ? r2(preco - totalCustos) : 0;
  return {
    preco: r2(preco),
    custoProdutoTotal,
    custosVariaveis: r2(e.custosVariaveis),
    extras,
    extrasTotal,
    comissao,
    comissaoLimitada,
    imposto,
    taxaFixa,
    taxaCpf,
    totalCustos,
    lucro,
    margemReal: preco > 0 ? r2((lucro / preco) * 100) : 0,
    markup: custoProdutoTotal > 0 ? r2(preco / custoProdutoTotal) : 0,
  };
}

// Resolve P a partir de: P = fixos + P·(pct) + lucro(P)
// onde lucro(P) = P·m (modo margem) ou L (modo lucro).
function resolverPreco(e) {
  const { taxas } = e;
  const fixos = somaProdutos(e) + e.custosVariaveis
    + e.extras.filter((x) => x.tipo === 'fixo').reduce((s, x) => s + x.valor, 0)
    + taxas.taxaFixa + (e.tipoVendedor === 'cpf' ? taxas.taxaCpf : 0);
  const pct = (e.impostoPct + e.extras.filter((x) => x.tipo === 'percentual').reduce((s, x) => s + x.valor, 0)) / 100;
  const m = e.modo === 'margem' ? e.margemPct / 100 : 0;
  const L = e.modo === 'lucro' ? e.lucroDesejado : 0;
  const c = taxas.comissaoPct / 100;

  let den = 1 - pct - c - m;
  if (den <= 0) return { erro: 'A soma de comissão, impostos, extras percentuais e margem chega a 100% ou mais — não existe preço que feche essa conta.' };
  let preco = (fixos + L) / den;

  if (taxas.comissaoTeto > 0 && preco * c > taxas.comissaoTeto) {
    den = 1 - pct - m;
    if (den <= 0) return { erro: 'Percentuais somam 100% ou mais.' };
    preco = (fixos + taxas.comissaoTeto + L) / den;
  }
  return { preco };
}

export function calcular(entrada) {
  const e = normalizarEntrada(entrada);
  if (e.modo === 'preco') return { entrada: e, ...detalharPreco(e.precoVenda, e) };

  const vazio = e.produtos.every((p) => p.custo === 0) && e.custosVariaveis === 0 && e.extras.length === 0
    && (e.modo === 'margem' || e.lucroDesejado === 0);
  if (vazio) return { entrada: e, ...detalharPreco(0, e) };

  const { preco, erro } = resolverPreco(e);
  if (erro) return { entrada: e, erro, ...detalharPreco(0, e) };
  // Arredonda para cima no centavo e, como comissão/imposto também são arredondados
  // em centavos, sobe mais alguns centavos até o lucro real atingir o pedido.
  const atingiu = (d) => (e.modo === 'margem' ? d.lucro >= r2(d.preco * e.margemPct / 100) : d.lucro >= r2(e.lucroDesejado));
  let d = detalharPreco(ceil2(preco), e);
  for (let i = 0; i < 20 && !atingiu(d); i++) d = detalharPreco(r2(d.preco + 0.01), e);
  return { entrada: e, ...d };
}
