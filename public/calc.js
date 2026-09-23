// Motor de cálculo compartilhado entre o navegador e o servidor.
// O servidor sempre recalcula antes de salvar, então o que vai para o banco
// é exatamente o que esta função produz — nunca um número vindo do cliente.

// Tabela da Shopee desde 1º/03/2026: comissão e taxa fixa dependem da FAIXA de preço
// do item. `ate` é o maior preço da faixa (null = sem limite). A taxa fixa é
// `taxaFixa` em R$ + `taxaFixaPct` % do preço (abaixo de R$ 8 ela é metade do preço).
// Não há mais teto de comissão (`comissaoTeto` 0 = sem teto).
export const FAIXAS_PADRAO = Object.freeze([
  Object.freeze({ ate: 7.99, comissaoPct: 20, taxaFixa: 0, taxaFixaPct: 50, comissaoTeto: 0 }),
  // R$ 4,00 até 30/09/2026; R$ 4,50 a partir de 01/10/2026 (anúncio da Shopee)
  Object.freeze({ ate: 79.99, comissaoPct: 20, taxaFixa: 4.5, taxaFixaPct: 0, comissaoTeto: 0 }),
  Object.freeze({ ate: 99.99, comissaoPct: 14, taxaFixa: 16, taxaFixaPct: 0, comissaoTeto: 0 }),
  Object.freeze({ ate: 199.99, comissaoPct: 14, taxaFixa: 20, taxaFixaPct: 0, comissaoTeto: 0 }),
  Object.freeze({ ate: null, comissaoPct: 14, taxaFixa: 26, taxaFixaPct: 0, comissaoTeto: 0 }),
]);

export const TAXAS_PADRAO = Object.freeze({
  faixas: FAIXAS_PADRAO,
  taxaCpf: 3, // adicional por item para vendedor CPF com mais de 450 pedidos em 90 dias
});

// Lê números no formato brasileiro: "12,50", "1.234,56", "R$ 12,50", "15 %".
// Com vírgula, pontos são milhar; sem vírgula, um ponto só é decimal ("4.5").
const num = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let s = String(v ?? '').replace(/[R$%\s]/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
const pos = (v) => Math.max(0, num(v));

const qtdValida = (v) => Math.min(999, Math.max(1, Math.floor(num(v) || 1)));

// Aceita a tabela nova ({faixas, taxaCpf}) e o formato antigo de taxa única
// ({comissaoPct, comissaoTeto, taxaFixa, taxaCpf}), guardado em anúncios antigos.
export function normalizarTaxas(t) {
  const taxas = t || {};
  let faixas;
  if (Array.isArray(taxas.faixas) && taxas.faixas.length) {
    faixas = taxas.faixas.slice(0, 12).map((f) => ({
      ate: f?.ate === null || f?.ate === undefined || f?.ate === '' ? null : r2(pos(f.ate)),
      comissaoPct: pos(f?.comissaoPct),
      taxaFixa: pos(f?.taxaFixa),
      taxaFixaPct: pos(f?.taxaFixaPct),
      comissaoTeto: pos(f?.comissaoTeto),
    }));
    faixas.sort((a, b) => (a.ate ?? Infinity) - (b.ate ?? Infinity));
    faixas[faixas.length - 1].ate = null; // a última faixa sempre vai até o infinito
  } else if (taxas.comissaoPct !== undefined || taxas.taxaFixa !== undefined) {
    faixas = [{
      ate: null,
      comissaoPct: pos(taxas.comissaoPct ?? 20),
      taxaFixa: pos(taxas.taxaFixa ?? 4),
      taxaFixaPct: 0,
      comissaoTeto: pos(taxas.comissaoTeto),
    }];
  } else {
    faixas = FAIXAS_PADRAO.map((f) => ({ ...f }));
  }
  return { faixas, taxaCpf: pos(taxas.taxaCpf ?? TAXAS_PADRAO.taxaCpf) };
}

export function faixaDoPreco(preco, taxas) {
  return taxas.faixas.find((f) => f.ate === null || preco <= f.ate + 1e-9);
}

export function normalizarEntrada(e = {}) {
  // Kits: vários produtos, cada um com custo e quantidade. Sem a lista,
  // usa o formato antigo (um custo só) para os anúncios já salvos.
  const listaProdutos = Array.isArray(e.produtos) && e.produtos.length
    ? e.produtos
    : [{ custo: e.custoProduto, quantidade: e.quantidade }];
  const produtos = listaProdutos.slice(0, 20).map((p) => ({
    custo: pos(p?.custo),
    quantidade: qtdValida(p?.quantidade),
  }));
  return {
    tipoVendedor: e.tipoVendedor === 'cnpj' ? 'cnpj' : 'cpf',
    produtos,
    // Espelho do primeiro produto, para quem ainda lê os campos antigos.
    custoProduto: produtos[0].custo,
    quantidade: produtos[0].quantidade,
    impostoPct: pos(e.impostoPct),
    custosVariaveis: pos(e.custosVariaveis),
    extras: (Array.isArray(e.extras) ? e.extras : [])
      .map((x) => ({
        nome: String(x?.nome ?? '').trim().slice(0, 60),
        tipo: x?.tipo === 'percentual' ? 'percentual' : 'fixo',
        valor: pos(x?.valor),
      }))
      .filter((x) => x.nome || x.valor > 0),
    modo: ['margem', 'preco', 'lucro'].includes(e.modo) ? e.modo : 'margem',
    // Metas negativas (prejuízo planejado) quase sempre são erro de digitação: viram 0.
    margemPct: pos(e.margemPct),
    precoVenda: pos(e.precoVenda),
    lucroDesejado: pos(e.lucroDesejado),
    taxas: normalizarTaxas(e.taxas),
  };
}

const somaProdutos = (e) => r2(e.produtos.reduce((s, p) => s + p.custo * p.quantidade, 0));

function deDaFaixa(faixa, taxas) {
  const i = taxas.faixas.indexOf(faixa);
  return i > 0 ? r2(taxas.faixas[i - 1].ate + 0.01) : 0;
}

// Detalha custos e lucro para um preço de venda já definido.
export function detalharPreco(precoInformado, e) {
  const { taxas } = e;
  // Tudo é calculado sobre o preço já em centavos, o mesmo que vai para a Shopee.
  const preco = r2(pos(precoInformado));
  // Sem preço (tela vazia), mostra a faixa de taxa fixa em R$ (a de R$ 8 a R$ 79,99),
  // e não a de "metade do preço", que daria taxa zero.
  const faixa = preco > 0 ? faixaDoPreco(preco, taxas) : (taxas.faixas.find((f) => !f.taxaFixaPct) ?? taxas.faixas[0]);
  const custoProdutoTotal = somaProdutos(e);
  const comissaoBruta = preco * faixa.comissaoPct / 100;
  const comissaoLimitada = faixa.comissaoTeto > 0 && comissaoBruta > faixa.comissaoTeto;
  const comissao = r2(comissaoLimitada ? faixa.comissaoTeto : comissaoBruta);
  const imposto = r2(preco * e.impostoPct / 100);
  const extras = e.extras.map((x) => ({
    ...x,
    custo: r2(x.tipo === 'percentual' ? preco * x.valor / 100 : x.valor),
  }));
  const extrasTotal = r2(extras.reduce((s, x) => s + x.custo, 0));
  // Taxas por item aparecem sempre, mesmo antes de haver preço: toda venda paga.
  const taxaFixa = r2(faixa.taxaFixa + preco * faixa.taxaFixaPct / 100);
  const taxaCpf = e.tipoVendedor === 'cpf' ? taxas.taxaCpf : 0;
  const totalCustos = r2(custoProdutoTotal + e.custosVariaveis + extrasTotal + comissao + imposto + taxaFixa + taxaCpf);
  // Sem preço ainda não há venda, então não mostramos prejuízo.
  const lucro = preco > 0 ? r2(preco - totalCustos) : 0;
  return {
    preco,
    faixa: { ...faixa, de: deDaFaixa(faixa, taxas) },
    custoProdutoTotal,
    custosVariaveis: r2(e.custosVariaveis),
    extras,
    extrasTotal,
    comissao,
    comissaoPct: faixa.comissaoPct,
    comissaoLimitada,
    imposto,
    taxaFixa,
    taxaCpf,
    totalCustos,
    lucro,
    // Truncada (nunca arredondada para cima): a tela nunca mostra margem maior que a real.
    margemReal: preco > 0 ? Math.floor((lucro / preco) * 10000 + 1e-7) / 100 : 0,
    markup: custoProdutoTotal > 0 ? r2(preco / custoProdutoTotal) : 0,
  };
}

// Menor preço DENTRO de uma faixa que entrega a meta, ou null se a faixa não comporta.
// Resolve P = fixos + P·(percentuais) + meta com a comissão/taxa fixa da faixa e
// depois procura centavo a centavo (comissão, imposto e extras são arredondados).
function melhorPrecoNaFaixa(e, faixa, de, atingiu) {
  const fixos = somaProdutos(e) + e.custosVariaveis
    + e.extras.filter((x) => x.tipo === 'fixo').reduce((s, x) => s + x.valor, 0)
    + faixa.taxaFixa + (e.tipoVendedor === 'cpf' ? e.taxas.taxaCpf : 0);
  const pct = (e.impostoPct + faixa.taxaFixaPct
    + e.extras.filter((x) => x.tipo === 'percentual').reduce((s, x) => s + x.valor, 0)) / 100;
  const m = e.modo === 'margem' ? e.margemPct / 100 : 0;
  const L = e.modo === 'lucro' ? e.lucroDesejado : 0;
  const c = faixa.comissaoPct / 100;

  let den = 1 - pct - c - m;
  if (den <= 0) return { semSolucao: true };
  let exato = (fixos + L) / den;
  if (faixa.comissaoTeto > 0 && exato * c > faixa.comissaoTeto) {
    den = 1 - pct - m;
    if (den <= 0) return { semSolucao: true };
    exato = (fixos + faixa.comissaoTeto + L) / den;
  }
  const ate = faixa.ate ?? Infinity;
  // O arredondamento em centavos (comissão, imposto, extras, taxa %) pode somar alguns
  // centavos a favor; dividido pelo denominador, isso vira a folga de busca abaixo do
  // preço exato. Se o exato passa do limite da faixa, só os preços logo abaixo do
  // limite podem servir.
  const arredondamentos = 3 + e.extras.length;
  const folga = (0.005 * arredondamentos) / den + 0.02;
  if (exato - folga > ate) return null;
  let centavos = Math.max(Math.round(de * 100), 1, Math.floor((Math.min(exato, ate) - folga) * 100));
  for (let i = 0; i < 100000; i++, centavos++) {
    const p = centavos / 100;
    if (p > ate + 1e-9) return null;
    const d = detalharPreco(p, e);
    if (atingiu(d)) return d;
  }
  return null;
}

// Se o preço caiu numa faixa mais cara, verifica o limite de cada faixa mais barata
// (ex.: R$ 79,99, R$ 99,99) e sugere o que der a MAIOR margem — a taxa da Shopee
// cai bastante abaixo de cada limite.
function alternativaAbaixo(e, r) {
  const i = e.taxas.faixas.findIndex((f) => f.ate === r.faixa.ate);
  let melhor = null;
  for (const f of e.taxas.faixas.slice(0, Math.max(i, 0))) {
    const d = detalharPreco(f.ate, e);
    if (d.lucro <= 0) continue;
    if (!melhor || d.margemReal > melhor.margemReal) melhor = d;
  }
  if (!melhor) return null;
  return { preco: melhor.preco, lucro: melhor.lucro, margemReal: melhor.margemReal, economia: r2(r.preco - melhor.preco) };
}

export function calcular(entrada) {
  const e = normalizarEntrada(entrada);
  if (e.modo === 'preco') return { entrada: e, ...detalharPreco(e.precoVenda, e), alternativa: null };

  const vazio = e.produtos.every((p) => p.custo === 0) && e.custosVariaveis === 0 && e.extras.length === 0
    && (e.modo === 'margem' || e.lucroDesejado === 0);
  if (vazio) return { entrada: e, ...detalharPreco(0, e), alternativa: null };

  // No modo margem, a margem real exata (lucro ÷ preço) nunca fica abaixo da pedida.
  const atingiu = (d) => (e.modo === 'margem' ? d.lucro >= d.preco * e.margemPct / 100 - 1e-9 : d.lucro >= r2(e.lucroDesejado));
  // As faixas vão do preço menor para o maior: a primeira que comporta a meta
  // dá o menor preço possível.
  let semSolucao = true;
  for (const faixa of e.taxas.faixas) {
    const r = melhorPrecoNaFaixa(e, faixa, deDaFaixa(faixa, e.taxas), atingiu);
    if (r?.semSolucao) continue;
    semSolucao = false;
    if (r) return { entrada: e, ...r, alternativa: alternativaAbaixo(e, r) };
  }
  const erro = semSolucao
    ? 'A soma de comissão, impostos, extras percentuais e margem chega a 100% ou mais — não existe preço que feche essa conta.'
    : 'Não foi possível encontrar um preço que entregue essa meta.';
  return { entrada: e, erro, ...detalharPreco(0, e), alternativa: null };
}
