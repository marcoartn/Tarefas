(function () {
const $ = (s) => document.querySelector(s);
const brl = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (v) => `${(Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
const pct2 = (v) => `${(Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const paraTexto = (v) => (v ? String(v).replace('.', ',') : '');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICONES = {
  marca: '<svg viewBox="0 0 64 64" aria-hidden="true" class="a-marca"><g fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M30 18.5 21.5 10.5"/><path d="M34 18.5 40.5 9"/><path d="M38.8 24.5h8.2"/></g><g fill="none" stroke="currentColor" stroke-width="2.6"><circle cx="19" cy="8" r="3.3"/><circle cx="42.3" cy="6.2" r="3.3"/><circle cx="50.6" cy="24.5" r="3.3"/></g><path fill="currentColor" fill-rule="evenodd" d="M28.6 18h6.8l18.6 42H43.5l-3.2-8.4H23.7l-3.2 8.4H10zM32 30.6l-5 13.3h10z"/></svg>',
  caixa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/></svg>',
  editar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/><path d="M17.6 3.6a2 2 0 0 1 2.8 2.8L12 14.8l-3.6.8.8-3.6z"/></svg>',
  duplicar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
  comentario: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 12a8 8 0 1 1 3.3 6.5L4 20l1.2-3.6A7.9 7.9 0 0 1 4 12z"/></svg>',
  apagar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
};

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* sem storage */ } }

const estado = {
  db: null,
  usuario: null,
  dono: true,          // confirmado em iniciar(); sem a capability user, assume dono
  uid: null,
  taxasPorLoja: {},    // taxas/{lojaId}: só o dono escreve
  solicitacoes: [],    // (dono) pedidos pendentes de todos
  minhaSolic: null,    // (não-dono) meu último pedido
  lojas: [],
  lojaId: lsGet('loja'),
  pararAnuncios: null,
  confirmandoLoja: null,
  taxas: { ...TAXAS_PADRAO },
  tipoVendedor: 'cpf', produtos: [{ custo: '', quantidade: 1 }], modo: 'margem',
  extras: [], tags: [], imagem: null,
  editandoId: null,
  anuncios: [],
  carregado: false,
  filtroTags: new Set(), modoTag: 'contem',
  visao: lsGet('visao') || 'lista',
  resultado: null,
  confirmandoApagar: null,
  comentariosAbertos: new Set(),
  soMargemBaixa: false,
};

let toastTimer;
function toast(msg, erro = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast visivel${erro ? ' erro' : ''}`;
  clearTimeout(toastTimer);
  // Mensagens longas ficam mais tempo na tela (tempo de leitura).
  toastTimer = setTimeout(() => { t.className = 'toast'; }, Math.max(2800, msg.length * 65));
}

function mensagemErroDb(e) {
  if (e?.code === 'quota_exceeded') return 'O banco atingiu o limite de anúncios. Exclua alguns para salvar novos.';
  if (e?.code === 'invalid_argument') return 'Só o dono desta página pode alterar os dados.';
  if (e?.code === 'resource_exhausted') return 'Muitas operações seguidas. Espere alguns segundos e tente de novo.';
  return 'Não foi possível falar com o banco. Tente de novo em instantes.';
}

// ---------- Formulário ----------
function lerEntrada() {
  return {
    tipoVendedor: estado.tipoVendedor,
    produtos: estado.produtos,
    impostoPct: $('#impostoPct').value,
    custosVariaveis: $('#custosVariaveis').value,
    extras: estado.extras,
    modo: estado.modo,
    margemPct: $('#margemPct').value,
    precoVenda: $('#precoVenda').value,
    lucroDesejado: $('#lucroDesejado').value,
    taxas: estado.taxas,
  };
}

function ativarSegmento(container, valor) {
  container.querySelectorAll('button').forEach((b) => b.classList.toggle('ativo', b.dataset.v === valor));
}

// Grupos do gráfico, na ordem da barra. Paleta validada (daltonismo e visão normal)
// nesta ordem de vizinhança; `escuro` = texto escuro sobre a cor.
const GRUPOS = [
  { id: 'produto', nome: 'Produto', cor: '#2a78d6' },
  { id: 'imposto', nome: 'Imposto', cor: '#eda100', escuro: true },
  { id: 'variaveis', nome: 'Custos variáveis e extras', cor: '#e87ba4', escuro: true },
  { id: 'taxas', nome: 'Taxas por item', cor: '#4a3aa7' },
  { id: 'comissao', nome: 'Comissão Shopee', cor: '#eb6834', escuro: true },
  { id: 'lucro', nome: 'Lucro', cor: '#1baf7a', escuro: true },
];
const GRUPO_DA_LINHA = { produto: 'produto', variaveis: 'variaveis', extras: 'variaveis', comissao: 'comissao', imposto: 'imposto', fixa: 'taxas', cpf: 'taxas' };
const corGrupo = (id) => GRUPOS.find((g) => g.id === id).cor;

function valoresPorGrupo(d) {
  return {
    produto: d.custoProdutoTotal,
    imposto: d.imposto,
    variaveis: d.custosVariaveis + d.extrasTotal,
    taxas: d.taxaFixa + d.taxaCpf,
    comissao: d.comissao,
    lucro: Math.max(d.lucro, 0),
  };
}

function renderResultado() {
  const r = calcular(lerEntrada());
  estado.resultado = r;
  const t = estado.taxas;
  $('#preco-final').textContent = brl(r.preco);
  $('#rotulo-preco').textContent = estado.modo === 'preco' ? 'Preço de venda informado' : 'Preço para cadastrar na Shopee';
  $('#kpi-lucro').textContent = brl(r.lucro);
  $('#kpi-margem').textContent = pct2(r.margemReal);
  $('#destaque').classList.toggle('negativo', r.lucro < 0);
  $('#erro-calculo').hidden = !r.erro;
  $('#erro-calculo').textContent = r.erro || '';
  renderAlertaMargem(r);
  renderFaixa(r);

  const linhas = [
    ...(r.entrada.produtos.length > 1
      ? r.entrada.produtos.map((p, i) => ['produto', `Produto ${i + 1} <span class="sub">(${p.quantidade} × ${brl(p.custo)})</span>`, p.custo * p.quantidade])
      : [['produto', `Custo do produto${r.entrada.quantidade > 1 ? ` <span class="sub">(${r.entrada.quantidade} × ${brl(r.entrada.custoProduto)})</span>` : ''}`, r.custoProdutoTotal]]),
    ['variaveis', 'Custos variáveis', r.custosVariaveis],
    ...r.extras.map((x) => ['extras', `${esc(x.nome || 'Extra')} <span class="sub">${x.tipo === 'percentual' ? pct(x.valor) : 'fixo'}</span>`, x.custo]),
    ['comissao', `Comissão Shopee <span class="sub">(${pct(r.comissaoPct)}${r.comissaoLimitada ? ` · teto ${brl(r.faixa.comissaoTeto)}` : ''})</span>`, r.comissao],
    ['imposto', `Imposto <span class="sub">(${pct(r.entrada.impostoPct)})</span>`, r.imposto],
    ['fixa', `Taxa fixa por item${r.faixa.taxaFixaPct ? ` <span class="sub">(${pct(r.faixa.taxaFixaPct)} do preço)</span>` : ''}`, r.taxaFixa],
  ];
  if (estado.tipoVendedor === 'cpf') linhas.push(['cpf', 'Taxa extra CPF', r.taxaCpf]);

  $('#detalhe').innerHTML = linhas.map(([tipo, rotulo, valor]) => {
    const g = GRUPO_DA_LINHA[tipo];
    return `<tr data-grupo="${g}"><td><span class="cor" style="background:${corGrupo(g)}"></span>${rotulo}</td><td>${brl(valor)}</td></tr>`;
  }).join('')
    + `<tr class="total"><td>Total de custos + taxas</td><td>${brl(r.totalCustos)}</td></tr>`
    + `<tr class="lucro" data-grupo="lucro"><td><span class="cor" style="background:${corGrupo('lucro')}"></span>Lucro líquido</td><td class="${r.lucro < 0 ? 'neg' : 'pos'}">${brl(r.lucro)}</td></tr>`;

  renderBarra(r.erro ? { preco: 0 } : r);
}

function rotuloFaixa(f) {
  if (f.ate === null) return `${brl(f.de)} ou mais`;
  return f.de > 0 ? `${brl(f.de)} a ${brl(f.ate)}` : `até ${brl(f.ate)}`;
}
const descFaixa = (f) => `${pct(f.comissaoPct)} + ${f.taxaFixaPct ? `${pct(f.taxaFixaPct)} do preço` : brl(f.taxaFixa)}`;

function renderFaixa(r) {
  const info = $('#faixa-info');
  const tem = r && r.preco > 0 && !r.erro && estado.taxas.faixas.length > 1;
  info.hidden = !tem;
  if (tem) info.textContent = `Faixa Shopee: ${rotuloFaixa(r.faixa)} · ${descFaixa(r.faixa)} por item`;
  const a = r?.alternativa;
  $('#dica-faixa').hidden = !a;
  if (!a) return;
  $('#dica-faixa-txt').textContent = `Seu preço caiu numa faixa mais cara da Shopee. Vendendo por ${brl(a.preco)} você fica com margem de ${pct2(a.margemReal)} (lucro ${brl(a.lucro)}), ${brl(a.economia)} mais barato para o cliente.`;
  $('#dica-faixa-usar').textContent = `Usar ${brl(a.preco)}`;
  estado.precoDica = a.preco;
}

function renderAlertaMargem(r = estado.resultado) {
  const el = $('#alerta-margem');
  const min = margemMinima();
  const baixo = r && r.preco > 0 && !r.erro && r.margemReal < min - 1e-9;
  el.hidden = !baixo;
  if (!baixo) return;
  el.classList.toggle('prejuizo', r.lucro < 0);
  $('#alerta-margem-txt').textContent = r.lucro < 0
    ? `Prejuízo de ${brl(-r.lucro)} por venda`
    : `Cuidado: margem baixa (${pct2(r.margemReal)}, mínimo ${pct(min)})`;
}

// ---------- Gráfico "Para onde vai o seu preço" ----------
function montarBarra() {
  $('#barra').innerHTML = GRUPOS.map((g) =>
    `<span class="seg${g.escuro ? ' escuro' : ''}" data-grupo="${g.id}" tabindex="0" style="background:${g.cor};flex:0 1 0px"></span>`).join('');
}

function renderBarra(d) {
  const v = valoresPorGrupo(d);
  const base = Math.max(d.preco, d.totalCustos, 0.01);
  estado.viz = { v, base, preco: d.preco };
  const vazio = d.preco <= 0;
  $('#viz').hidden = vazio;
  if (vazio) return;
  for (const el of document.querySelectorAll('#barra .seg')) {
    const val = v[el.dataset.grupo];
    const parte = val / base;
    el.style.flexGrow = val > 0 ? parte : 0;
    el.style.display = val > 0 ? '' : 'none';
    el.textContent = parte >= 0.09 ? `${Math.round(parte * 100)}%` : '';
    el.setAttribute('aria-label', `${GRUPOS.find((g) => g.id === el.dataset.grupo).nome}: ${brl(val)}, ${pct2(parte * 100)} do preço`);
  }
  const alerta = $('#viz-alerta');
  alerta.hidden = d.lucro >= 0;
  if (d.lucro < 0) alerta.textContent = `Prejuízo de ${brl(-d.lucro)}: os custos passam do preço.`;
}

function focarGrupo(grupo, alvoSeg) {
  const barra = $('#barra'); const tabela = $('#detalhe'); const tip = $('#viz-tip');
  barra.classList.toggle('focando', !!grupo);
  tabela.classList.toggle('focando', !!grupo);
  barra.querySelectorAll('.seg').forEach((s) => s.classList.toggle('ativo', s.dataset.grupo === grupo));
  tabela.querySelectorAll('tr[data-grupo]').forEach((tr) => tr.classList.toggle('ativo', tr.dataset.grupo === grupo));
  const seg = alvoSeg || (grupo && barra.querySelector(`.seg[data-grupo="${grupo}"]`));
  if (!grupo || !seg || seg.style.display === 'none' || !estado.viz) { tip.hidden = true; return; }
  const g = GRUPOS.find((x) => x.id === grupo);
  const val = estado.viz.v[grupo];
  tip.innerHTML = `<b>${brl(val)}</b>${esc(g.nome)} <small>· ${pct2((val / estado.viz.base) * 100)} do preço</small>`;
  const caixa = $('#viz').getBoundingClientRect(); const r = seg.getBoundingClientRect();
  tip.hidden = false;
  const meio = r.left + r.width / 2 - caixa.left;
  const metade = tip.offsetWidth / 2;
  tip.style.left = `${Math.min(Math.max(meio, metade), caixa.width - metade)}px`;
  tip.style.top = `${r.top - caixa.top - 6}px`;
}


function renderAvisoCpf() {
  const cpf = estado.tipoVendedor === 'cpf';
  $('#aviso-cpf').className = `aviso${cpf ? '' : ' info'}`;
  $('#aviso-cpf').textContent = cpf
    ? `Vendedor CPF: taxa extra de ${brl(estado.taxas.taxaCpf)} por item (Shopee cobra de CPF com mais de 450 pedidos em 90 dias; abaixo disso, marque CNPJ).`
    : 'Vendedor CNPJ: sem taxa extra por item.';
}

function renderExtras() {
  $('#extras-lista').innerHTML = estado.extras.map((x, i) => `
    <div class="extra-linha" data-i="${i}">
      <input data-k="nome" placeholder="Ex.: Shopee Ads" value="${esc(x.nome)}" aria-label="Nome do custo extra" />
      <select data-k="tipo" aria-label="Tipo do custo extra">
        <option value="fixo"${x.tipo === 'fixo' ? ' selected' : ''}>R$</option>
        <option value="percentual"${x.tipo === 'percentual' ? ' selected' : ''}>%</option>
      </select>
      <input data-k="valor" inputmode="decimal" placeholder="0" value="${esc(paraTexto(x.valor))}" aria-label="Valor do custo extra" />
      <button type="button" data-remover="${i}" aria-label="Remover custo extra">✕</button>
    </div>`).join('');
  $('#extras-contagem').textContent = estado.extras.length ? `· ${estado.extras.length}` : '';
}

function renderProdutos() {
  const varios = estado.produtos.length > 1;
  $('#produtos-lista').innerHTML = estado.produtos.map((p, i) => `
    <div class="produto-linha" data-i="${i}">
      ${varios ? `<span class="produto-num" aria-hidden="true">${i + 1}</span>` : ''}
      <div class="entrada-com-prefixo">
        <em>R$</em><input data-custo id="custo-produto-${i}" type="text" inputmode="decimal" placeholder="0,00" value="${esc(p.custo)}" aria-label="Custo do produto ${i + 1}" />
        <div class="qtd">
          <button type="button" data-qtd="-1" aria-label="Diminuir quantidade do produto ${i + 1}">−</button>
          <strong>${p.quantidade}x</strong>
          <button type="button" data-qtd="1" aria-label="Aumentar quantidade do produto ${i + 1}">+</button>
        </div>
      </div>
      ${varios ? `<button type="button" class="remover-produto" data-remover-produto aria-label="Remover produto ${i + 1}">✕</button>` : ''}
    </div>`).join('');
  renderTotalProdutos();
}

function renderTotalProdutos() {
  const el = $('#produtos-total');
  el.hidden = estado.produtos.length < 2;
  if (el.hidden) return;
  const total = calcular({ produtos: estado.produtos }).custoProdutoTotal;
  const unidades = estado.produtos.reduce((s, p) => s + (Number(p.quantidade) || 1), 0);
  el.innerHTML = `${estado.produtos.length} produtos · ${unidades} unidades · total <b>${brl(total)}</b>`;
}

function renderTagsForm() {
  const box = $('#tags-entrada');
  box.querySelectorAll('.tag').forEach((e) => e.remove());
  const input = $('#tag-input');
  estado.tags.forEach((t, i) => {
    const el = document.createElement('span');
    el.className = 'tag';
    el.innerHTML = `${esc(t)}<button type="button" data-remover-tag="${i}" aria-label="Remover tag ${esc(t)}">×</button>`;
    box.insertBefore(el, input);
  });
}

function renderImagem() {
  $('#foto-preview').hidden = !estado.imagem;
  $('#foto-placeholder').hidden = !!estado.imagem;
  $('#remover-foto').hidden = !estado.imagem;
  if (estado.imagem) $('#foto-preview').src = estado.imagem;
}

function renderModo() {
  ativarSegmento($('#modo'), estado.modo);
  document.querySelectorAll('.modo-campo').forEach((el) => { el.hidden = el.dataset.modo !== estado.modo; });
}

function preencherFormulario(a) {
  estado.tipoVendedor = a?.tipoVendedor ?? 'cpf';
  estado.produtos = (a?.produtos?.length ? a.produtos : [{ custo: a?.custoProduto, quantidade: a?.quantidade ?? 1 }])
    .map((p) => ({ custo: paraTexto(p.custo), quantidade: p.quantidade || 1 }));
  estado.modo = a?.modo ?? 'margem';
  estado.extras = (a?.extras ?? []).map((x) => ({ ...x }));
  estado.tags = [...(a?.tags ?? [])];
  estado.imagem = a?.imagem ?? null;
  $('#impostoPct').value = paraTexto(a?.impostoPct);
  $('#custosVariaveis').value = paraTexto(a?.custosVariaveis);
  $('#margemPct').value = paraTexto(a?.margemPct) || '0';
  $('#margemRange').value = a?.margemPct ?? 0;
  $('#precoVenda').value = paraTexto(a?.precoVenda);
  $('#lucroDesejado').value = paraTexto(a?.lucroDesejado);
  $('#nome').value = a?.nome ?? '';
  $('#comentario').value = a?.comentario ?? '';
  $('#tag-input').value = '';
  renderProdutos();
  $('#extras-box').open = estado.extras.length > 0;
  ativarSegmento($('#tipo-vendedor'), estado.tipoVendedor);
  renderAvisoCpf(); renderExtras(); renderTagsForm(); renderImagem(); renderModo(); renderResultado();
}

function definirEdicao(anuncio) {
  estado.editandoId = anuncio?.id ?? null;
  $('#editando').hidden = !anuncio;
  $('#editando-nome').textContent = anuncio?.nome ?? '';
  $('#salvar').textContent = anuncio ? 'Atualizar anúncio' : 'Salvar precificação';
  renderLista();
}

// ---------- Anúncios salvos ----------
// Na lista mostramos a margem escolhida (o preço garante que a real nunca fica abaixo);
// nos modos por preço ou por lucro não há margem escolhida, então vale a real.
const margemExibida = (a) => (a.modo === 'margem' ? Number(a.margemPct) || 0 : a.resultado.margemReal);

const MARGEM_MIN_PADRAO = 8;
const margemMinima = () => {
  const v = Number(lojaAtual()?.margemMinima);
  return Number.isFinite(v) && v >= 0 ? v : MARGEM_MIN_PADRAO;
};
const abaixoDoMinimo = (a) => margemExibida(a) < margemMinima() - 1e-9;
const ALERTA_SVG = '<svg class="icone-alerta" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/></svg>';
// Vermelho abaixo do seu mínimo, verde a partir de 15% (ou do mínimo, se for maior), amarelo no meio.
function classeMargem(m) {
  const min = margemMinima();
  return m < min - 1e-9 ? 'ruim' : m >= Math.max(15, min) ? 'bom' : 'medio';
}

function anunciosFiltrados() {
  const termo = $('#busca').value.trim().toLowerCase();
  const filtro = [...estado.filtroTags].map((t) => t.toLowerCase());
  return estado.anuncios.filter((a) => {
    if (termo && !a.nome.toLowerCase().includes(termo) && !(a.comentario || '').toLowerCase().includes(termo)) return false;
    if (estado.soMargemBaixa && !abaixoDoMinimo(a)) return false;
    if (!filtro.length) return true;
    const minhas = (a.tags || []).map((t) => t.toLowerCase());
    const temTodas = filtro.every((t) => minhas.includes(t));
    return estado.modoTag === 'somente' ? temTodas && minhas.length === filtro.length : temTodas;
  });
}

function renderChips() {
  const contagem = new Map();
  for (const a of estado.anuncios) for (const t of a.tags || []) {
    const k = t.toLowerCase();
    contagem.set(k, { tag: contagem.get(k)?.tag ?? t, total: (contagem.get(k)?.total ?? 0) + 1 });
  }
  for (const t of estado.filtroTags) if (!contagem.has(t.toLowerCase())) estado.filtroTags.delete(t);
  const todas = [...contagem.values()].sort((a, b) => b.total - a.total || a.tag.localeCompare(b.tag));
  $('#chips-tags').innerHTML = `<button type="button" class="chip${estado.filtroTags.size ? '' : ' ativo'}" data-chip="">Todas</button>`
    + todas.map(({ tag, total }) => `<button type="button" class="chip${estado.filtroTags.has(tag) ? ' ativo' : ''}" data-chip="${esc(tag)}">${esc(tag)} <small>${total}</small></button>`).join('');
  $('#tags-sugestoes').innerHTML = todas.map(({ tag }) => `<option value="${esc(tag)}"></option>`).join('');
}

// Recalcula o anúncio com as taxas atuais da loja: se o preço (ou, no modo preço de
// venda, o lucro) mudou, o anúncio foi salvo com regras antigas da Shopee.
function seloDesatualizado(a) {
  try {
    const novo = calcular({ ...a, taxas: estado.taxas });
    if (novo.erro) return '';
    if (a.modo === 'preco') {
      if (Math.abs(novo.lucro - a.resultado.lucro) < 0.005) return '';
      return `<span class="desatualizado" title="Salvo com taxas antigas. Com a tabela atual o lucro é ${brl(novo.lucro)} (margem ${pct2(novo.margemReal)}). Clique em Editar e Atualizar.">Lucro hoje: ${brl(novo.lucro)}</span>`;
    }
    if (Math.abs(novo.preco - a.resultado.preco) < 0.005) return '';
    return `<span class="desatualizado" title="Salvo com taxas antigas. Com a tabela atual, o preço para a mesma meta é ${brl(novo.preco)}. Clique em Editar e Atualizar.">Preço desatualizado → ${brl(novo.preco)}</span>`;
  } catch { return ''; }
}

function renderFiltroMargem() {
  const total = estado.anuncios.filter(abaixoDoMinimo).length;
  if (!total) estado.soMargemBaixa = false;
  const b = $('#filtro-baixa');
  b.hidden = !total;
  b.setAttribute('aria-pressed', String(estado.soMargemBaixa));
  b.innerHTML = `${ALERTA_SVG.replace('icone-alerta', '')}Margem baixa (${total})`;
  const inp = $('#margem-min');
  if (document.activeElement !== inp) inp.value = paraTexto(margemMinima()) || '0';
  inp.disabled = !lojaAtual();
}

function renderLista() {
  renderFiltroMargem();
  const itens = anunciosFiltrados();
  $('#total').textContent = `(${estado.anuncios.length})`;
  $('#lista').className = `lista${estado.visao === 'grade' ? ' grade' : ''}`;
  ativarSegmento($('#visao'), estado.visao);

  if (itens.length) {
    const lucroTotal = itens.reduce((s, a) => s + a.resultado.lucro, 0);
    const margemMedia = itens.reduce((s, a) => s + a.resultado.margemReal, 0) / itens.length;
    const baixos = itens.filter(abaixoDoMinimo).length;
    $('#resumo').textContent = `${itens.length} anúncio(s) · lucro médio ${brl(lucroTotal / itens.length)} · margem média ${pct(margemMedia)}`
      + (baixos ? ` · ${baixos} abaixo de ${pct(margemMinima())}` : '');
  } else {
    $('#resumo').textContent = '';
  }

  let vazio = 'Nenhum anúncio corresponde ao filtro.';
  if (!estado.anuncios.length) {
    vazio = !estado.db ? 'O banco de dados não está disponível nesta visualização.'
      : !estado.carregado ? 'Carregando anúncios…'
      : 'Nenhum anúncio salvo ainda. Faça um cálculo, dê um nome e clique em “Salvar precificação”.';
  }

  $('#lista').innerHTML = itens.length ? itens.map((a) => {
    const r = a.resultado;
    const confirmando = estado.confirmandoApagar === a.id;
    const aberto = estado.comentariosAbertos.has(a.id);
    return `
    <article class="item${a.id === estado.editandoId ? ' selecionado' : ''}" data-id="${esc(a.id)}">
      <div class="thumb">${a.imagem ? `<img src="${esc(a.imagem)}" alt="" loading="lazy" />` : ICONES.marca}</div>
      <div class="corpo">
        <div class="info">
          <div class="nome-item" title="${esc(a.nome)}">${esc(a.nome)}</div>
          <div class="preco-item">${brl(r.preco)}</div>
          <div class="lucro-linha">
            <span class="lucro-item">Lucro: <b class="${r.lucro < 0 ? 'neg' : ''}">${brl(r.lucro)}</b>${(a.produtos?.length ?? 1) > 1 ? ` <span class="kit">· kit ${a.produtos.length} produtos</span>` : a.quantidade > 1 ? ` <span class="kit">· kit ${a.quantidade}x</span>` : ''}</span>
            ${(a.tags || []).length ? `<span class="tags-item">${a.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</span>` : ''}
          </div>
        </div>
        <span class="margem-txt ${classeMargem(margemExibida(a))}" title="Margem real: ${pct2(r.margemReal)}${abaixoDoMinimo(a) ? ` · abaixo do mínimo de ${pct(margemMinima())}` : ''}">${abaixoDoMinimo(a) ? ALERTA_SVG : ''}Margem: ${pct2(margemExibida(a))}</span>
        ${seloDesatualizado(a)}
        ${a.comentario ? `<button type="button" class="btn-comentario" data-acao="comentario" aria-expanded="${aberto}" title="${esc(a.comentario)}" aria-label="Ver comentário">${ICONES.comentario}</button>` : ''}
        ${a.comentario && aberto ? `<div class="comentario-aberto">${esc(a.comentario)}</div>` : ''}
      </div>
      <div class="botoes">
        <button type="button" data-acao="editar" title="Editar" aria-label="Editar">${ICONES.editar}</button>
        <button type="button" data-acao="duplicar" title="Duplicar" aria-label="Duplicar">${ICONES.duplicar}</button>
        ${confirmando
          ? '<button type="button" data-acao="confirmar-apagar" class="confirmar">Excluir?</button>'
          : `<button type="button" data-acao="apagar" class="apagar" title="Excluir" aria-label="Excluir">${ICONES.apagar}</button>`}
      </div>
    </article>`;
  }).join('') : `<p class="vazio">${ICONES.marca}${vazio}</p>`;
}

// ---------- Banco ----------
function limparTags(tags) {
  const vistos = new Map();
  for (const t of tags) {
    const s = String(t ?? '').trim().slice(0, 30);
    if (s && !vistos.has(s.toLowerCase())) vistos.set(s.toLowerCase(), s);
  }
  return [...vistos.values()].slice(0, 20);
}

// Monta o documento a partir das entradas, recalculando tudo na hora de salvar.
function montarDocumento(base) {
  const nome = String(base.nome ?? '').trim().slice(0, 200);
  if (!nome) throw new Error('Dê um nome ao anúncio antes de salvar.');
  const entrada = normalizarEntrada(base);
  const r = calcular(entrada);
  if (r.erro) throw new Error(r.erro);
  if (r.preco <= 0) throw new Error('Preencha os custos para gerar um preço antes de salvar.');
  return {
    nome,
    comentario: String(base.comentario ?? '').slice(0, 2000),
    imagem: base.imagem || null,
    tags: limparTags(base.tags || []),
    tipoVendedor: entrada.tipoVendedor,
    produtos: entrada.produtos,
    custoProduto: entrada.custoProduto,
    quantidade: entrada.quantidade,
    impostoPct: entrada.impostoPct,
    custosVariaveis: entrada.custosVariaveis,
    extras: entrada.extras,
    modo: entrada.modo,
    margemPct: entrada.margemPct,
    precoVenda: entrada.precoVenda,
    lucroDesejado: entrada.lucroDesejado,
    taxas: entrada.taxas,
    resultado: {
      preco: r.preco, comissao: r.comissao, imposto: r.imposto, extrasTotal: r.extrasTotal,
      totalCustos: r.totalCustos, lucro: r.lucro, margemReal: r.margemReal,
    },
  };
}

async function salvar() {
  if (!estado.db) return toast('Banco indisponível nesta visualização.', true);
  if (!lojaAtual()) return toast('Crie uma loja antes de salvar.', true);
  const pendente = $('#tag-input').value.trim();
  const base = {
    ...lerEntrada(),
    nome: $('#nome').value, comentario: $('#comentario').value,
    tags: pendente ? [...estado.tags, pendente] : estado.tags,
    imagem: estado.imagem,
  };
  let docu;
  try { docu = montarDocumento(base); } catch (err) {
    if (!base.nome.trim()) $('#nome').focus();
    return toast(err.message, true);
  }
  const agora = new Date().toISOString();
  const btn = $('#salvar'); btn.disabled = true;
  try {
    const col = colAnuncios();
    if (estado.editandoId) {
      const anterior = estado.anuncios.find((a) => a.id === estado.editandoId);
      await col.doc(estado.editandoId).set({ ...docu, criadoEm: anterior?.criadoEm ?? agora, atualizadoEm: agora });
      toast('Anúncio atualizado.');
    } else {
      await col.doc().set({ ...docu, criadoEm: agora, atualizadoEm: agora });
      toast('Anúncio salvo.');
    }
    preencherFormulario(null);
    definirEdicao(null);
  } catch (err) {
    toast(mensagemErroDb(err), true);
  } finally {
    btn.disabled = !estado.db;
  }
}

async function duplicar(a) {
  const agora = new Date().toISOString();
  const { id, ...resto } = a;
  await colAnuncios().doc().set({ ...resto, nome: `${a.nome} (cópia)`.slice(0, 200), criadoEm: agora, atualizadoEm: agora });
  toast('Anúncio duplicado.');
}

const lojaAtual = () => estado.lojas.find((l) => l.id === estado.lojaId) ?? null;
const colAnuncios = (lojaId = estado.lojaId) => estado.db.collection(`lojas/${lojaId}/anuncios`);

function falhaConexao(err) {
  $('#status-banco').className = 'status-banco erro';
  $('#status-banco').innerHTML = '<span>Banco desconectado</span>';
  $('#faixa-erro').hidden = false;
  $('#faixa-erro').textContent = err?.code === 'revoked'
    ? 'O acesso ao banco foi encerrado. Recarregue a página.'
    : 'A conexão com o banco caiu. Recarregue a página para ver os dados atualizados.';
}

function renderSeletorLoja() {
  const sel = $('#loja-select');
  sel.disabled = !estado.lojas.length;
  sel.innerHTML = estado.lojas.length
    ? estado.lojas.map((l) => `<option value="${esc(l.id)}"${l.id === estado.lojaId ? ' selected' : ''}>${esc(l.nome)}</option>`).join('')
    : '<option>Nenhuma loja</option>';
}

function renderLojas() {
  const primeira = !estado.lojas.length;
  const dono = estado.dono;
  $('#lojas-titulo').textContent = primeira ? (dono ? 'Crie sua primeira loja' : 'Nenhuma loja ainda') : (dono ? 'Suas lojas' : 'Lojas');
  $('#lojas-intro').textContent = primeira
    ? (dono ? 'Os anúncios ficam separados por loja. Dê um nome para começar.' : 'O dono desta página ainda não criou nenhuma loja.')
    : (dono ? 'Cada loja tem os próprios anúncios, tags e taxas. Clique no nome para renomear.' : 'Escolha a loja para trabalhar. Só o dono cria, renomeia ou exclui lojas.');
  $('#fechar-lojas').hidden = primeira && dono;
  $('#lojas-marca').hidden = !primeira;
  $('#form-nova-loja').hidden = !dono;
  $('#lojas-lista').innerHTML = estado.lojas.map((l) => `
    <li class="${l.id === estado.lojaId ? 'atual' : ''}" data-loja="${esc(l.id)}">
      <input value="${esc(l.nome)}" maxlength="60" aria-label="Nome da loja" ${dono ? 'data-renomear' : 'readonly tabindex="-1"'} />
      ${l.id === estado.lojaId ? '<small>Aberta</small>' : '<button type="button" data-abrir>Abrir</button>'}
      ${!dono ? '' : estado.confirmandoLoja === l.id
        ? '<button type="button" class="confirmar" data-confirmar-excluir>Excluir tudo?</button>'
        : '<button type="button" class="excluir" data-excluir>Excluir</button>'}
    </li>`).join('');
}

function abrirLojas() {
  estado.confirmandoLoja = null;
  renderLojas();
  $('#lojas').hidden = false;
  if (!estado.lojas.length && estado.dono) $('#nova-loja-nome').focus();
}

function selecionarLoja(id) {
  if (id === estado.lojaId && estado.pararAnuncios) return;
  const trocouDeLoja = !!estado.pararAnuncios; // na primeira carga mantém o exemplo da calculadora
  estado.pararAnuncios?.();
  estado.pararAnuncios = null;
  estado.lojaId = id;
  estado.anuncios = [];
  estado.carregado = false;
  estado.filtroTags.clear();
  estado.soMargemBaixa = false;
  $('#busca').value = '';
  if (id) lsSet('loja', id);
  aplicarTaxasDaLoja();
  if (trocouDeLoja) preencherFormulario(null);
  definirEdicao(null);
  renderSeletorLoja(); renderChips(); renderLista();
  $('#salvar').disabled = !id;
  if (!id) return;

  estado.pararAnuncios = colAnuncios(id).onSnapshot((snap) => {
    if (estado.lojaId !== id) return;
    estado.anuncios = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((a) => a.nome && a.resultado)
      .sort((a, b) => String(b.atualizadoEm).localeCompare(String(a.atualizadoEm)));
    estado.carregado = true;
    if (estado.editandoId && !estado.anuncios.some((a) => a.id === estado.editandoId)) {
      preencherFormulario(null); definirEdicao(null);
    }
    renderChips(); renderLista();
  }, falhaConexao);
}

function taxasDaLoja(id) {
  // taxas/{id} é a fonte; lojas antigas guardavam as taxas no próprio documento.
  const loja = estado.lojas.find((l) => l.id === id);
  return normalizarTaxas(estado.taxasPorLoja[id] || loja?.taxas || TAXAS_PADRAO);
}

function aplicarTaxasDaLoja() {
  estado.taxas = taxasDaLoja(estado.lojaId);
  renderAvisoCpf(); renderResultado();
  renderLista(); // selos de "preço desatualizado" dependem das taxas
}

function ligarBanco(db) {
  estado.db = db;
  $('#status-banco').className = 'status-banco ok';
  $('#status-banco').innerHTML = '<span>Banco conectado</span>';

  db.collection('taxas').onSnapshot((snap) => {
    estado.taxasPorLoja = Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]));
    aplicarTaxasDaLoja();
  }, falhaConexao);

  if (estado.dono) {
    db.collection('solicitacoes').onSnapshot((snap) => {
      estado.solicitacoes = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .filter((x) => x.status === 'pendente')
        .sort((a, b) => String(a.criadoEm).localeCompare(String(b.criadoEm)));
      renderBadge();
      if (!$('#config').hidden) renderPendentes();
    }, () => {});
  } else if (estado.uid) {
    db.doc(`solicitacoes/${estado.uid}`).onSnapshot((snap) => {
      const anterior = estado.minhaSolic;
      estado.minhaSolic = snap.exists ? snap.data() : null;
      const agora = estado.minhaSolic;
      if (anterior?.status === 'pendente' && agora && agora.status !== 'pendente') {
        toast(agora.status === 'aprovada' ? 'Sua solicitação de taxas foi aprovada.' : 'Sua solicitação de taxas foi recusada.', agora.status !== 'aprovada');
      }
      if (!$('#config').hidden) renderConfigModo();
    }, () => {});
  }

  db.collection('lojas').onSnapshot((snap) => {
    estado.lojas = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((l) => l.nome)
      .sort((a, b) => String(a.criadoEm).localeCompare(String(b.criadoEm)));
    const alvo = estado.lojas.some((l) => l.id === estado.lojaId) ? estado.lojaId : (estado.lojas[0]?.id ?? null);
    if (alvo !== estado.lojaId || !estado.pararAnuncios) selecionarLoja(alvo);
    else { aplicarTaxasDaLoja(); renderLista(); } // margem mínima pode ter mudado
    renderSeletorLoja();
    if (!$('#lojas').hidden || !estado.lojas.length) {
      if ($('#lojas').hidden) abrirLojas(); else renderLojas();
    }
  }, falhaConexao);
}

async function criarLoja(nome) {
  nome = nome.trim().slice(0, 60);
  if (!nome) return toast('Dê um nome para a loja.', true);
  if (estado.lojas.some((l) => l.nome.toLowerCase() === nome.toLowerCase())) return toast('Já existe uma loja com esse nome.', true);
  const ref = estado.db.collection('lojas').doc();
  await estado.db.doc(`taxas/${ref.id}`).set({ ...TAXAS_PADRAO });
  await ref.set({ nome, criadoEm: new Date().toISOString() });
  $('#nova-loja-nome').value = '';
  selecionarLoja(ref.id);
  $('#lojas').hidden = true;
  toast(`Loja “${nome}” criada.`);
}

async function excluirLoja(id) {
  const loja = estado.lojas.find((l) => l.id === id);
  if (!loja) return;
  // Apagar a loja não apaga os documentos aninhados: remove os anúncios um a um.
  const snap = await colAnuncios(id).get();
  for (const d of snap.docs) await colAnuncios(id).doc(d.id).delete();
  await estado.db.doc(`lojas/${id}`).delete();
  await estado.db.doc(`taxas/${id}`).delete();
  toast(`Loja “${loja.nome}” excluída.`);
}

// ---------- Eventos ----------
function ligarEventos() {
  document.querySelectorAll('.entradas input[type=text]').forEach((el) => el.addEventListener('input', renderResultado));

  montarBarra();
  const barra = $('#barra');
  barra.addEventListener('mouseover', (e) => { const seg = e.target.closest('.seg'); if (seg) focarGrupo(seg.dataset.grupo, seg); });
  barra.addEventListener('focusin', (e) => { const seg = e.target.closest('.seg'); if (seg) focarGrupo(seg.dataset.grupo, seg); });
  barra.addEventListener('mouseleave', () => focarGrupo(null));
  barra.addEventListener('focusout', () => focarGrupo(null));
  $('#detalhe').addEventListener('mouseover', (e) => { const tr = e.target.closest('tr[data-grupo]'); focarGrupo(tr?.dataset.grupo ?? null); });
  $('#detalhe').addEventListener('mouseleave', () => focarGrupo(null));

  $('#dica-faixa-usar').addEventListener('click', () => {
    if (!estado.precoDica) return;
    $('#precoVenda').value = paraTexto(estado.precoDica.toFixed(2));
    estado.modo = 'preco'; renderModo(); renderResultado();
    toast(`Preço de ${brl(estado.precoDica)} aplicado no modo “Por preço de venda”.`);
  });

  $('#tipo-vendedor').addEventListener('click', (e) => {
    const v = e.target.closest('button')?.dataset.v; if (!v) return;
    estado.tipoVendedor = v;
    ativarSegmento($('#tipo-vendedor'), v); renderAvisoCpf(); renderResultado();
  });

  $('#add-produto').addEventListener('click', () => {
    if (estado.produtos.length >= 20) return toast('Limite de 20 produtos por kit.', true);
    estado.produtos.push({ custo: '', quantidade: 1 });
    renderProdutos(); renderResultado();
    $('#produtos-lista .produto-linha:last-child input').focus();
  });
  $('#produtos-lista').addEventListener('input', (e) => {
    const i = Number(e.target.closest('[data-i]')?.dataset.i);
    if (!e.target.matches('[data-custo]') || !Number.isInteger(i)) return;
    estado.produtos[i].custo = e.target.value;
    renderTotalProdutos(); renderResultado();
  });
  $('#produtos-lista').addEventListener('click', (e) => {
    const i = Number(e.target.closest('[data-i]')?.dataset.i); if (!Number.isInteger(i)) return;
    const d = Number(e.target.closest('[data-qtd]')?.dataset.qtd);
    if (d) {
      estado.produtos[i].quantidade = Math.max(1, Math.min(999, (Number(estado.produtos[i].quantidade) || 1) + d));
    } else if (e.target.closest('[data-remover-produto]')) {
      estado.produtos.splice(i, 1);
    } else return;
    renderProdutos(); renderResultado();
  });

  $('#modo').addEventListener('click', (e) => {
    const v = e.target.closest('button')?.dataset.v; if (!v) return;
    if (v === 'preco' && estado.resultado?.preco && !$('#precoVenda').value) $('#precoVenda').value = paraTexto(estado.resultado.preco);
    estado.modo = v; renderModo(); renderResultado();
  });

  $('#margemRange').addEventListener('input', (e) => { $('#margemPct').value = paraTexto(e.target.value) || '0'; renderResultado(); });
  $('#margemPct').addEventListener('input', (e) => { $('#margemRange').value = Number(e.target.value.replace(',', '.')) || 0; });

  $('#add-extra').addEventListener('click', () => {
    estado.extras.push({ nome: '', tipo: 'fixo', valor: 0 });
    renderExtras(); $('#extras-lista .extra-linha:last-child input').focus();
  });
  $('#extras-lista').addEventListener('input', (e) => {
    const i = Number(e.target.closest('.extra-linha')?.dataset.i); const k = e.target.dataset.k;
    if (!Number.isInteger(i) || !k) return;
    estado.extras[i][k] = e.target.value; renderResultado();
  });
  $('#extras-lista').addEventListener('click', (e) => {
    const i = e.target.closest('[data-remover]')?.dataset.remover; if (i === undefined) return;
    estado.extras.splice(Number(i), 1); renderExtras(); renderResultado();
  });

  $('#tag-input').addEventListener('keydown', (e) => {
    const v = e.target.value.trim().replace(/,$/, '');
    if ((e.key === 'Enter' || e.key === ',') && v) {
      e.preventDefault();
      if (!estado.tags.some((t) => t.toLowerCase() === v.toLowerCase())) estado.tags.push(v.slice(0, 30));
      e.target.value = ''; renderTagsForm();
    } else if (e.key === 'Backspace' && !e.target.value && estado.tags.length) {
      estado.tags.pop(); renderTagsForm();
    }
  });
  $('#tags-entrada').addEventListener('click', (e) => {
    const i = e.target.closest('[data-remover-tag]')?.dataset.removerTag; if (i === undefined) return;
    estado.tags.splice(Number(i), 1); renderTagsForm();
  });

  $('#foto-input').addEventListener('change', async (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    try {
      const { url, original } = await reduzirImagem(f);
      estado.imagem = url; renderImagem();
      if (original < FOTO_MINIMO_BOM) toast(`Imagem pequena (${original}×${original} px): vai ficar pixelada. Use a foto original do produto, não a miniatura.`, true);
    } catch { toast('Não consegui ler essa imagem. Tente um JPG ou PNG.', true); }
  });
  $('#remover-foto').addEventListener('click', () => { estado.imagem = null; renderImagem(); });

  $('#copiar').addEventListener('click', async () => {
    const valor = (estado.resultado?.preco ?? 0).toFixed(2).replace('.', ',');
    try { await navigator.clipboard.writeText(valor); toast(`Copiado: ${valor}`); }
    catch { toast(`Preço: ${valor} (copie manualmente)`); }
  });

  $('#salvar').addEventListener('click', salvar);
  const limpar = () => { preencherFormulario(null); definirEdicao(null); };
  $('#limpar').addEventListener('click', limpar);
  $('#cancelar-edicao').addEventListener('click', limpar);

  $('#visao').addEventListener('click', (e) => {
    const v = e.target.closest('button')?.dataset.v; if (!v) return;
    estado.visao = v; lsSet('visao', v); renderLista();
  });
  $('#modo-tag').addEventListener('click', (e) => {
    const v = e.target.closest('button')?.dataset.v; if (!v) return;
    estado.modoTag = v; ativarSegmento($('#modo-tag'), v); renderLista();
  });
  $('#chips-tags').addEventListener('click', (e) => {
    const b = e.target.closest('[data-chip]'); if (!b) return;
    const t = b.dataset.chip;
    if (!t) estado.filtroTags.clear();
    else if (estado.filtroTags.has(t)) estado.filtroTags.delete(t);
    else estado.filtroTags.add(t);
    renderChips(); renderLista();
  });
  $('#busca').addEventListener('input', renderLista);
  $('#filtro-baixa').addEventListener('click', () => { estado.soMargemBaixa = !estado.soMargemBaixa; renderLista(); });
  let timerMargemMin;
  $('#margem-min').addEventListener('input', (e) => {
    const v = Number(e.target.value.replace(',', '.'));
    if (!Number.isFinite(v) || v < 0 || v >= 100 || !lojaAtual()) return;
    const loja = lojaAtual();
    loja.margemMinima = v; // aplica já na tela; grava no banco após uma pausa
    renderLista(); renderAlertaMargem();
    clearTimeout(timerMargemMin);
    timerMargemMin = setTimeout(async () => {
      if (!estado.db) return;
      try { await estado.db.doc(`lojas/${loja.id}`).update({ margemMinima: v }); }
      catch (err) { toast(mensagemErroDb(err), true); }
    }, 700);
  });

  let timerConfirmar;
  $('#lista').addEventListener('click', async (e) => {
    const acao = e.target.closest('[data-acao]')?.dataset.acao;
    const id = e.target.closest('.item')?.dataset.id;
    if (!acao || !id) return;
    const a = estado.anuncios.find((x) => x.id === id);
    if (!a) return;
    try {
      if (acao === 'comentario') {
        if (estado.comentariosAbertos.has(id)) estado.comentariosAbertos.delete(id); else estado.comentariosAbertos.add(id);
        renderLista();
      } else if (acao === 'editar') {
        preencherFormulario(a); definirEdicao(a);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else if (!estado.db) {
        toast('Banco indisponível nesta visualização.', true);
      } else if (acao === 'duplicar') {
        await duplicar(a);
      } else if (acao === 'apagar') {
        estado.confirmandoApagar = id; renderLista();
        clearTimeout(timerConfirmar);
        timerConfirmar = setTimeout(() => { estado.confirmandoApagar = null; renderLista(); }, 4000);
      } else if (acao === 'confirmar-apagar') {
        clearTimeout(timerConfirmar);
        estado.confirmandoApagar = null;
        await colAnuncios().doc(id).delete();
        if (estado.editandoId === id) limpar();
        toast('Anúncio excluído.');
      }
    } catch (err) { toast(mensagemErroDb(err), true); }
  });

  $('#loja-select').addEventListener('change', (e) => selecionarLoja(e.target.value));
  $('#abrir-lojas').addEventListener('click', () => {
    if (!estado.db) return toast('Banco indisponível nesta visualização.', true);
    abrirLojas();
  });
  $('#fechar-lojas').addEventListener('click', () => { $('#lojas').hidden = true; });
  $('#lojas').addEventListener('click', (e) => { if (e.target === $('#lojas') && estado.lojas.length) $('#lojas').hidden = true; });
  $('#form-nova-loja').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button'); btn.disabled = true;
    try { await criarLoja($('#nova-loja-nome').value); } catch (err) { toast(mensagemErroDb(err), true); }
    finally { btn.disabled = false; }
  });
  $('#lojas-lista').addEventListener('change', async (e) => {
    if (!e.target.matches('[data-renomear]') || !estado.dono) return;
    const id = e.target.closest('[data-loja]').dataset.loja;
    const nome = e.target.value.trim().slice(0, 60);
    const loja = estado.lojas.find((l) => l.id === id);
    if (!nome || !loja) { e.target.value = loja?.nome ?? ''; return toast('O nome não pode ficar vazio.', true); }
    if (nome === loja.nome) return;
    try { await estado.db.doc(`lojas/${id}`).update({ nome }); toast('Loja renomeada.'); }
    catch (err) { e.target.value = loja.nome; toast(mensagemErroDb(err), true); }
  });
  let timerLoja;
  $('#lojas-lista').addEventListener('click', async (e) => {
    const li = e.target.closest('[data-loja]'); if (!li) return;
    const id = li.dataset.loja;
    if (e.target.closest('[data-abrir]')) { selecionarLoja(id); $('#lojas').hidden = true; return; }
    if (e.target.closest('[data-excluir]')) {
      estado.confirmandoLoja = id; renderLojas();
      clearTimeout(timerLoja);
      timerLoja = setTimeout(() => { estado.confirmandoLoja = null; if (!$('#lojas').hidden) renderLojas(); }, 4000);
      return;
    }
    if (e.target.closest('[data-confirmar-excluir]')) {
      clearTimeout(timerLoja); estado.confirmandoLoja = null;
      e.target.disabled = true; e.target.textContent = 'Excluindo…';
      try { await excluirLoja(id); } catch (err) { toast(mensagemErroDb(err), true); renderLojas(); }
    }
  });

  $('#abrir-config').addEventListener('click', () => {
    if (estado.db && !lojaAtual()) return abrirLojas();
    preencherTaxasForm(estado.taxas);
    $('#cfg-motivo').value = '';
    renderConfigModo();
    $('#config').hidden = false;
    (estado.dono && estado.solicitacoes.length ? $('#pendentes button') : $('#faixas-corpo input'))?.focus();
  });
  const fecharConfig = () => { $('#config').hidden = true; };
  $('#fechar-config').addEventListener('click', fecharConfig);
  $('#config').addEventListener('click', (e) => { if (e.target === $('#config')) fecharConfig(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#config').hidden) fecharConfig();
    else if (!$('#lojas').hidden && estado.lojas.length) $('#lojas').hidden = true;
  });

  $('#form-config').addEventListener('submit', async (e) => {
    e.preventDefault();
    const novas = lerTaxasForm();
    if (novas.faixas.some((f) => f.comissaoPct >= 100)) return toast('A comissão precisa ser menor que 100%.', true);
    if (!estado.db) {
      estado.taxas = novas; renderAvisoCpf(); renderResultado(); fecharConfig();
      return toast('Taxas aplicadas só nesta sessão (banco indisponível).');
    }
    if (!lojaAtual()) return toast('Escolha uma loja primeiro.', true);
    const btn = $('#salvar-taxas'); btn.disabled = true;
    try {
      if (estado.dono) {
        await estado.db.doc(`taxas/${estado.lojaId}`).set(novas);
        fecharConfig(); toast('Taxas atualizadas.');
      } else {
        if (!estado.uid) return toast('Não foi possível identificar você. Recarregue a página.', true);
        if (JSON.stringify(novas) === JSON.stringify(estado.taxas)) return toast('Nenhum valor foi alterado.', true);
        const motivo = $('#cfg-motivo').value.trim().slice(0, 300);
        if (!motivo) { $('#cfg-motivo').focus(); return toast('Explique o motivo da alteração.', true); }
        await estado.db.doc(`solicitacoes/${estado.uid}`).set({
          status: 'pendente', autorId: estado.uid,
          lojaId: estado.lojaId, lojaNome: lojaAtual().nome,
          atuais: { ...estado.taxas }, propostas: novas, motivo,
          criadoEm: new Date().toISOString(),
        });
        fecharConfig(); toast('Solicitação enviada para o dono aprovar.');
      }
    } catch (err) { toast(mensagemErroDb(err), true); }
    finally { btn.disabled = false; }
  });

  $('#pendentes').addEventListener('click', async (e) => {
    const card = e.target.closest('[data-solic]'); if (!card) return;
    const aprovar = !!e.target.closest('[data-aprovar]');
    if (!aprovar && !e.target.closest('[data-recusar]')) return;
    const pedido = estado.solicitacoes.find((x) => x.id === card.dataset.solic);
    if (!pedido) return;
    card.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    try {
      if (aprovar) {
        const novas = normalizarTaxas(pedido.propostas);
        await estado.db.doc(`taxas/${pedido.lojaId}`).set(novas);
        if (pedido.lojaId === estado.lojaId) preencherTaxasForm(novas);
      }
      await estado.db.doc(`solicitacoes/${pedido.id}`).update({
        status: aprovar ? 'aprovada' : 'recusada', respondidoEm: new Date().toISOString(),
      });
      toast(aprovar ? `Taxas de “${pedido.lojaNome}” atualizadas.` : 'Solicitação recusada.');
    } catch (err) {
      toast(mensagemErroDb(err), true);
      card.querySelectorAll('button').forEach((b) => { b.disabled = false; });
    }
  });
}

// Faixas com o "de" calculado a partir do limite da faixa anterior.
const comDe = (faixas) => faixas.map((f, i) => ({ ...f, de: i > 0 ? Math.round((faixas[i - 1].ate + 0.01) * 100) / 100 : 0 }));

function preencherTaxasForm(taxas) {
  const t = normalizarTaxas(taxas);
  $('#faixas-corpo').innerHTML = comDe(t.faixas).map((f, i) => `
    <tr data-i="${i}">
      <td>${rotuloFaixa(f)}</td>
      <td><span class="entrada-com-prefixo curta"><input id="fx-${i}-pct" data-k="comissaoPct" inputmode="decimal" value="${esc(paraTexto(f.comissaoPct) || '0')}" aria-label="Comissão da faixa ${esc(rotuloFaixa(f))}" /><em>%</em></span></td>
      <td>${f.taxaFixaPct
        ? `<span class="entrada-com-prefixo curta"><input id="fx-${i}-fixo" data-k="taxaFixaPct" inputmode="decimal" value="${esc(paraTexto(f.taxaFixaPct))}" aria-label="Taxa fixa (% do preço) da faixa ${esc(rotuloFaixa(f))}" /><em>%</em></span><span class="do-preco">do preço</span>`
        : `<span class="entrada-com-prefixo curta"><em>R$</em><input id="fx-${i}-fixo" data-k="taxaFixa" inputmode="decimal" value="${esc(paraTexto(f.taxaFixa) || '0')}" aria-label="Taxa fixa da faixa ${esc(rotuloFaixa(f))}" /></span>`}</td>
    </tr>`).join('');
  $('#cfg-taxaCpf').value = paraTexto(t.taxaCpf) || '0';
  $('#faixas-corpo').dataset.base = JSON.stringify(t.faixas);
}

function lerTaxasForm() {
  const base = JSON.parse($('#faixas-corpo').dataset.base || '[]');
  const faixas = base.map((f, i) => {
    const novo = { ...f };
    for (const inp of document.querySelectorAll(`#faixas-corpo tr[data-i="${i}"] input`)) novo[inp.dataset.k] = inp.value;
    return novo;
  });
  return normalizarTaxas({ faixas, taxaCpf: $('#cfg-taxaCpf').value });
}

// Lista as diferenças entre duas tabelas de taxas, em texto legível.
function difTaxas(antes, depois) {
  const a = comDe(normalizarTaxas(antes).faixas); const d = comDe(normalizarTaxas(depois).faixas);
  const linhas = [];
  d.forEach((f, i) => {
    const o = a[i] || {};
    if (o.comissaoPct !== f.comissaoPct) linhas.push(`${rotuloFaixa(f)}: comissão <s>${pct(o.comissaoPct ?? 0)}</s> → <b>${pct(f.comissaoPct)}</b>`);
    if (o.taxaFixa !== f.taxaFixa) linhas.push(`${rotuloFaixa(f)}: taxa fixa <s>${brl(o.taxaFixa ?? 0)}</s> → <b>${brl(f.taxaFixa)}</b>`);
    if (o.taxaFixaPct !== f.taxaFixaPct) linhas.push(`${rotuloFaixa(f)}: taxa fixa <s>${pct(o.taxaFixaPct ?? 0)} do preço</s> → <b>${pct(f.taxaFixaPct)} do preço</b>`);
  });
  const ca = normalizarTaxas(antes).taxaCpf; const cd = normalizarTaxas(depois).taxaCpf;
  if (ca !== cd) linhas.push(`Taxa extra CPF: <s>${brl(ca)}</s> → <b>${brl(cd)}</b>`);
  return linhas;
}
const dataCurta = (iso) => { try { return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };

function renderBadge() {
  const n = estado.dono ? estado.solicitacoes.length : 0;
  $('#badge-solic').hidden = !n;
  $('#badge-solic').textContent = n;
  $('#abrir-config').title = n ? `${n} solicitação(ões) de alteração pendente(s)` : 'Taxas da Shopee';
}

function renderConfigModo() {
  const dono = estado.dono;
  $('#config-loja').textContent = lojaAtual() ? `Loja: ${lojaAtual().nome}` : '';
  $('#config-trava').hidden = dono;
  $('#motivo-campo').hidden = dono;
  const temPendente = !dono && estado.minhaSolic?.status === 'pendente';
  $('#salvar-taxas').textContent = dono ? 'Salvar taxas' : temPendente ? 'Substituir solicitação' : 'Enviar solicitação';
  const st = $('#status-solic');
  const m = !dono ? estado.minhaSolic : null;
  st.hidden = !m;
  if (m) {
    st.className = `status-solic ${m.status}`;
    st.textContent = m.status === 'pendente'
      ? `Sua solicitação para “${m.lojaNome}” (enviada ${dataCurta(m.criadoEm)}) está aguardando aprovação.`
      : `Sua última solicitação para “${m.lojaNome}” foi ${m.status === 'aprovada' ? 'aprovada' : 'recusada'} em ${dataCurta(m.respondidoEm)}.`;
  }
  renderPendentes();
}

async function renderPendentes() {
  const box = $('#pendentes');
  const lista = estado.dono ? estado.solicitacoes : [];
  box.hidden = !lista.length;
  if (!lista.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<p class="pendentes-titulo">${lista.length} solicitação(ões) aguardando sua aprovação</p>` + lista.map((p) => {
    const mudou = difTaxas(p.atuais, p.propostas);
    return `
    <article class="pendente" data-solic="${esc(p.id)}">
      <div class="pendente-topo"><b data-autor="${esc(p.autorId)}">Alguém</b> pede alteração em <b>${esc(p.lojaNome)}</b> <small>· ${dataCurta(p.criadoEm)}</small></div>
      <ul class="dif">${mudou.map((l) => `<li>${l}</li>`).join('') || '<li>Sem diferenças</li>'}</ul>
      ${p.motivo ? `<p class="motivo">“${esc(p.motivo)}”</p>` : ''}
      <div class="pendente-acoes">
        <button type="button" class="btn primario" data-aprovar>Aprovar</button>
        <button type="button" class="btn" data-recusar>Recusar</button>
      </div>
    </article>`;
  }).join('');
  // Nomes são resolvidos na hora de exibir; no banco guardamos só o id.
  if (!estado.usuario) return;
  const ids = [...new Set(lista.map((p) => p.autorId).filter(Boolean))];
  const perfis = await estado.usuario.profiles(ids);
  box.querySelectorAll('[data-autor]').forEach((el) => { el.textContent = perfis[el.dataset.autor]?.name || 'Alguém'; });
}

// Foto sempre quadrada (recorte central), no máx. 320px em JPEG, para caber no documento do banco.
const FOTO_LADO = 600;        // px do lado salvo (quadrado)
const FOTO_MINIMO_BOM = 300; // abaixo disso a foto de origem vai ficar pixelada
const FOTO_MAX_CHARS = 200000; // cabe folgado no documento do banco (limite 256 KB)

// Recorta o centro em quadrado e reduz em etapas (metade por vez), o que evita o
// serrilhado de reduzir de uma vez; depois comprime no JPEG de melhor qualidade que
// caiba no banco. Nunca aumenta a foto: amplificar só deixaria borrado.
function reduzirImagem(arquivo, lado = FOTO_LADO) {
  return new Promise((ok, falha) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      const q = Math.min(img.naturalWidth, img.naturalHeight);
      const quadrado = (tam) => {
        let c = document.createElement('canvas');
        c.width = q; c.height = q;
        c.getContext('2d').drawImage(img, (img.naturalWidth - q) / 2, (img.naturalHeight - q) / 2, q, q, 0, 0, q, q);
        while (c.width / 2 >= tam) {
          const m = document.createElement('canvas');
          m.width = Math.round(c.width / 2); m.height = m.width;
          const g = m.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(c, 0, 0, m.width, m.height);
          c = m;
        }
        if (c.width !== tam) {
          const f = document.createElement('canvas');
          f.width = tam; f.height = tam;
          const g = f.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(c, 0, 0, tam, tam);
          c = f;
        }
        return c;
      };
      for (const tam of [Math.min(lado, q), Math.min(480, q), Math.min(360, q)]) {
        const c = quadrado(tam);
        for (const qualidade of [0.9, 0.82, 0.72]) {
          const url = c.toDataURL('image/jpeg', qualidade);
          if (url.length <= FOTO_MAX_CHARS) return ok({ url, original: q, tam });
        }
      }
      ok({ url: quadrado(Math.min(300, q)).toDataURL('image/jpeg', 0.6), original: q, tam: Math.min(300, q) });
    };
    img.onerror = falha;
    img.src = URL.createObjectURL(arquivo);
  });
}

function iniciar() {
  $('#ano').textContent = new Date().getFullYear();
  ligarEventos();
  // A calculadora abre zerada; só mostra valores quando o usuário digita ou abre um anúncio.
  preencherFormulario(null);
  definirEdicao(null);
  $('#salvar').disabled = true;

  const usar = (nome) => (window.claude?.use ? Promise.resolve(window.claude.use(nome)).catch(() => null) : Promise.resolve(null));
  Promise.all([usar('db'), usar('user')]).then(async ([db, usuario]) => {
    estado.usuario = usuario;
    if (usuario) {
      estado.dono = await usuario.isOwner();
      estado.uid = await usuario.id();
    }
    document.body.classList.toggle('visitante', !estado.dono);
    if (db) return ligarBanco(db);
    $('#status-banco').className = 'status-banco erro';
    $('#status-banco').innerHTML = '<span>Sem banco</span>';
    $('#faixa-erro').hidden = false;
    $('#faixa-erro').textContent = 'O banco de dados não está disponível aqui. A calculadora funciona, mas os anúncios não podem ser salvos. Abra a página pelo link do claude.ai com sua conta.';
    renderLista();
  }).catch(() => renderLista());
}

iniciar();
})();
