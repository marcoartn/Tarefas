import { calcular, TAXAS_PADRAO } from './calc.js';

const $ = (s) => document.querySelector(s);
const brl = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (v) => `${(Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
const paraTexto = (v) => (v ? String(v).replace('.', ',') : '');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const estado = {
  taxas: { ...TAXAS_PADRAO },
  tipoVendedor: 'cpf',
  quantidade: 1,
  modo: 'margem',
  extras: [],
  tags: [],
  imagem: null,
  editandoId: null,
  anuncios: [],
  filtroTags: new Set(),
  modoTag: 'contem',
  visao: localStorageGet('visao') || 'lista',
  resultado: null,
};

function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch { /* sem storage */ } }

async function api(caminho, opcoes = {}) {
  const res = await fetch(`/api${caminho}`, {
    ...opcoes,
    headers: { 'Content-Type': 'application/json' },
    body: opcoes.body ? JSON.stringify(opcoes.body) : undefined,
  });
  if (res.status === 401) {
    location.replace('/login.html');
    throw new Error('Sessão expirada. Faça login de novo.');
  }
  if (res.status === 204) return null;
  const dados = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(dados.erro || `Erro ${res.status}`);
  return dados;
}

let toastTimer;
function toast(msg, erro = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast visivel${erro ? ' erro' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 2600);
}

// ---------- Formulário ----------
function lerEntrada() {
  return {
    tipoVendedor: estado.tipoVendedor,
    custoProduto: $('#custoProduto').value,
    quantidade: estado.quantidade,
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

const CORES = {
  produto: '#0f766e', variaveis: '#14b8a6', extras: '#5eead4', comissao: '#f97316',
  imposto: '#eab308', fixa: '#8b5cf6', cpf: '#c084fc', lucro: '#22c55e',
};

function renderResultado() {
  const r = calcular(lerEntrada());
  estado.resultado = r;
  const t = estado.taxas;

  $('#preco-final').textContent = brl(r.preco);
  $('#rotulo-preco').textContent = estado.modo === 'preco' ? 'Preço de venda informado' : 'Preço para cadastrar na Shopee';
  $('#kpi-lucro').textContent = brl(r.lucro);
  $('#kpi-margem').textContent = pct(r.margemReal);
  $('#kpi-markup').textContent = r.markup ? `${r.markup.toLocaleString('pt-BR')}x` : '—';
  $('#destaque').classList.toggle('negativo', r.lucro < 0);
  $('#erro-calculo').hidden = !r.erro;
  $('#erro-calculo').textContent = r.erro || '';

  const linhas = [
    ['produto', `Custo do produto${r.entrada.quantidade > 1 ? ` <span class="sub">(${r.entrada.quantidade} × ${brl(r.entrada.custoProduto)})</span>` : ''}`, r.custoProdutoTotal],
    ['variaveis', 'Custos variáveis', r.custosVariaveis],
    ...r.extras.map((x) => ['extras', `${esc(x.nome || 'Extra')} <span class="sub">${x.tipo === 'percentual' ? pct(x.valor) : 'fixo'}</span>`, x.custo]),
    ['comissao', `Comissão Shopee <span class="sub">(${pct(t.comissaoPct)}${r.comissaoLimitada ? ` · teto ${brl(t.comissaoTeto)}` : ''})</span>`, r.comissao],
    ['imposto', `Imposto <span class="sub">(${pct(r.entrada.impostoPct)})</span>`, r.imposto],
    ['fixa', 'Taxa fixa por item', r.taxaFixa],
  ];
  if (estado.tipoVendedor === 'cpf') linhas.push(['cpf', 'Taxa extra CPF', r.taxaCpf]);

  $('#detalhe').innerHTML = linhas.map(([cor, rotulo, valor]) =>
    `<tr><td><span class="cor" style="background:${CORES[cor]}"></span>${rotulo}</td><td>${brl(valor)}</td></tr>`).join('')
    + `<tr class="total"><td>Total de custos + taxas</td><td>${brl(r.totalCustos)}</td></tr>`
    + `<tr class="lucro"><td>Lucro líquido</td><td class="${r.lucro < 0 ? 'neg' : 'pos'}">${brl(r.lucro)}</td></tr>`;

  // Barra proporcional: para onde vai cada real do preço
  const base = Math.max(r.preco, r.totalCustos, 0.01);
  const partes = [...linhas.map(([cor, , v]) => [cor, v]), ['lucro', Math.max(r.lucro, 0)]];
  $('#barra').innerHTML = r.preco > 0
    ? partes.filter(([, v]) => v > 0).map(([cor, v]) => `<span style="width:${(v / base) * 100}%;background:${CORES[cor]}"></span>`).join('')
    : '';
}

function renderAvisoCpf() {
  const t = estado.taxas;
  $('#aviso-cpf').className = `aviso${estado.tipoVendedor === 'cnpj' ? ' info' : ''}`;
  $('#aviso-cpf').textContent = estado.tipoVendedor === 'cpf'
    ? `Vendedor CPF: taxa extra de ${brl(t.taxaCpf)} por item aplicada automaticamente.`
    : 'Vendedor CNPJ: sem taxa extra por item.';
}

function renderExtras() {
  $('#extras-lista').innerHTML = estado.extras.map((x, i) => `
    <div class="extra-linha" data-i="${i}">
      <input data-k="nome" placeholder="Ex.: Anúncio pago" value="${esc(x.nome)}" />
      <select data-k="tipo">
        <option value="fixo"${x.tipo === 'fixo' ? ' selected' : ''}>R$</option>
        <option value="percentual"${x.tipo === 'percentual' ? ' selected' : ''}>%</option>
      </select>
      <input data-k="valor" inputmode="decimal" placeholder="0" value="${esc(paraTexto(x.valor))}" />
      <button type="button" data-remover="${i}" title="Remover">✕</button>
    </div>`).join('');
  $('#extras-contagem').textContent = estado.extras.length ? `· ${estado.extras.length}` : '';
}

function renderTagsForm() {
  const box = $('#tags-entrada');
  box.querySelectorAll('.tag').forEach((e) => e.remove());
  const input = $('#tag-input');
  estado.tags.forEach((t, i) => {
    const el = document.createElement('span');
    el.className = 'tag';
    el.innerHTML = `${esc(t)}<button type="button" data-remover-tag="${i}" aria-label="Remover tag">×</button>`;
    box.insertBefore(el, input);
  });
}

function renderImagem() {
  $('#foto-preview').hidden = !estado.imagem;
  $('#foto-placeholder').hidden = !!estado.imagem;
  if (estado.imagem) $('#foto-preview').src = estado.imagem;
}

function renderModo() {
  ativarSegmento($('#modo'), estado.modo);
  document.querySelectorAll('.modo-campo').forEach((el) => { el.hidden = el.dataset.modo !== estado.modo; });
}

function preencherFormulario(a) {
  estado.tipoVendedor = a?.tipoVendedor ?? 'cpf';
  estado.quantidade = a?.quantidade ?? 1;
  estado.modo = a?.modo ?? 'margem';
  estado.extras = (a?.extras ?? []).map((x) => ({ ...x }));
  estado.tags = [...(a?.tags ?? [])];
  estado.imagem = a?.imagem ?? null;
  $('#custoProduto').value = paraTexto(a?.custoProduto);
  $('#impostoPct').value = paraTexto(a?.impostoPct);
  $('#custosVariaveis').value = paraTexto(a?.custosVariaveis);
  $('#margemPct').value = paraTexto(a?.margemPct) || '0';
  $('#margemRange').value = a?.margemPct ?? 0;
  $('#precoVenda').value = paraTexto(a?.precoVenda);
  $('#lucroDesejado').value = paraTexto(a?.lucroDesejado);
  $('#nome').value = a?.nome ?? '';
  $('#comentario').value = a?.comentario ?? '';
  $('#quantidade').textContent = `${estado.quantidade}x`;
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
function classeMargem(m) { return m >= 15 ? 'bom' : m >= 8 ? 'medio' : 'ruim'; }

function anunciosFiltrados() {
  const termo = $('#busca').value.trim().toLowerCase();
  const filtro = [...estado.filtroTags].map((t) => t.toLowerCase());
  return estado.anuncios.filter((a) => {
    if (termo && !a.nome.toLowerCase().includes(termo) && !a.comentario.toLowerCase().includes(termo)) return false;
    if (!filtro.length) return true;
    const minhas = a.tags.map((t) => t.toLowerCase());
    const temTodas = filtro.every((t) => minhas.includes(t));
    return estado.modoTag === 'somente' ? temTodas && minhas.length === filtro.length : temTodas;
  });
}

function renderChips() {
  const contagem = new Map();
  for (const a of estado.anuncios) for (const t of a.tags) {
    const k = t.toLowerCase();
    contagem.set(k, { tag: contagem.get(k)?.tag ?? t, total: (contagem.get(k)?.total ?? 0) + 1 });
  }
  // Remove do filtro tags que deixaram de existir
  for (const t of estado.filtroTags) if (!contagem.has(t.toLowerCase())) estado.filtroTags.delete(t);
  const todas = [...contagem.values()].sort((a, b) => b.total - a.total || a.tag.localeCompare(b.tag));
  $('#chips-tags').innerHTML = `<button class="chip${estado.filtroTags.size ? '' : ' ativo'}" data-chip="">Todas</button>`
    + todas.map(({ tag, total }) => `<button class="chip${estado.filtroTags.has(tag) ? ' ativo' : ''}" data-chip="${esc(tag)}">${esc(tag)} <small>${total}</small></button>`).join('');
  $('#tags-sugestoes').innerHTML = todas.map(({ tag }) => `<option value="${esc(tag)}"></option>`).join('');
}

function renderLista() {
  const itens = anunciosFiltrados();
  $('#total').textContent = `(${estado.anuncios.length})`;
  $('#lista').className = `lista${estado.visao === 'grade' ? ' grade' : ''}`;
  ativarSegmento($('#visao'), estado.visao);

  if (itens.length) {
    const lucroTotal = itens.reduce((s, a) => s + a.resultado.lucro, 0);
    const margemMedia = itens.reduce((s, a) => s + a.resultado.margemReal, 0) / itens.length;
    $('#resumo').textContent = `${itens.length} anúncio(s) · lucro médio ${brl(lucroTotal / itens.length)} · margem média ${pct(margemMedia)}`;
  } else {
    $('#resumo').textContent = '';
  }

  $('#lista').innerHTML = itens.length ? itens.map((a) => `
    <article class="item${a.id === estado.editandoId ? ' selecionado' : ''}" data-id="${a.id}">
      <div class="thumb">${a.imagem ? `<img src="${esc(a.imagem)}" alt="" loading="lazy" />` : '📦'}</div>
      <div class="info">
        <div class="nome-item" title="${esc(a.nome)}">${esc(a.nome)}</div>
        <div class="valores">
          <span>Preço <b>${brl(a.resultado.preco)}</b></span>
          <span>Lucro <b class="${a.resultado.lucro < 0 ? 'neg' : 'pos'}">${brl(a.resultado.lucro)}</b></span>
          <span>Custo <b>${brl(a.custoProduto * a.quantidade)}</b>${a.quantidade > 1 ? ` (${a.quantidade}x)` : ''}</span>
          <span>${a.tipoVendedor.toUpperCase()}</span>
        </div>
        ${a.comentario ? `<div class="comentario-item" title="${esc(a.comentario)}">💬 ${esc(a.comentario)}</div>` : ''}
        ${a.tags.length ? `<div class="tags-item">${a.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
      </div>
      <span class="margem ${classeMargem(a.resultado.margemReal)}">Margem ${pct(a.resultado.margemReal)}</span>
      <div class="botoes">
        <button data-acao="editar" title="Editar">✎</button>
        <button data-acao="duplicar" title="Duplicar">⧉</button>
        <button data-acao="apagar" class="apagar" title="Excluir">🗑</button>
      </div>
    </article>`).join('')
    : `<p class="vazio">${estado.anuncios.length ? 'Nenhum anúncio corresponde ao filtro.' : 'Nenhum anúncio salvo ainda. Faça um cálculo e clique em “Salvar precificação”.'}</p>`;
}

async function carregarAnuncios() {
  estado.anuncios = await api('/anuncios');
  renderChips();
  renderLista();
}

// ---------- Eventos ----------
function ligarEventos() {
  document.querySelectorAll('.entradas input[type=text]').forEach((el) => el.addEventListener('input', renderResultado));

  $('#tipo-vendedor').addEventListener('click', (e) => {
    const v = e.target.closest('button')?.dataset.v; if (!v) return;
    estado.tipoVendedor = v;
    ativarSegmento($('#tipo-vendedor'), v); renderAvisoCpf(); renderResultado();
  });

  document.querySelector('.qtd').addEventListener('click', (e) => {
    const d = Number(e.target.closest('button')?.dataset.qtd); if (!d) return;
    estado.quantidade = Math.max(1, Math.min(99, estado.quantidade + d));
    $('#quantidade').textContent = `${estado.quantidade}x`; renderResultado();
  });

  $('#modo').addEventListener('click', (e) => {
    const v = e.target.closest('button')?.dataset.v; if (!v) return;
    // Ao trocar de modo, leva o preço atual junto para o modo "preço de venda"
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
    try { estado.imagem = await reduzirImagem(f); renderImagem(); } catch { toast('Não consegui ler essa imagem.', true); }
  });
  $('#foto').addEventListener('contextmenu', (e) => {
    if (!estado.imagem) return;
    e.preventDefault(); estado.imagem = null; renderImagem(); toast('Foto removida.');
  });

  $('#copiar').addEventListener('click', async () => {
    const valor = (estado.resultado?.preco ?? 0).toFixed(2).replace('.', ',');
    try { await navigator.clipboard.writeText(valor); toast(`Copiado: ${valor}`); } catch { toast(valor); }
  });

  $('#salvar').addEventListener('click', salvar);
  $('#limpar').addEventListener('click', () => { preencherFormulario(null); definirEdicao(null); });
  $('#cancelar-edicao').addEventListener('click', () => { preencherFormulario(null); definirEdicao(null); });

  $('#visao').addEventListener('click', (e) => {
    const v = e.target.closest('button')?.dataset.v; if (!v) return;
    estado.visao = v; localStorageSet('visao', v); renderLista();
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

  $('#lista').addEventListener('click', async (e) => {
    const acao = e.target.closest('[data-acao]')?.dataset.acao;
    const id = Number(e.target.closest('.item')?.dataset.id);
    if (!acao || !id) return;
    const a = estado.anuncios.find((x) => x.id === id);
    try {
      if (acao === 'editar') {
        preencherFormulario(a); definirEdicao(a);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else if (acao === 'duplicar') {
        await api(`/anuncios/${id}/duplicar`, { method: 'POST' });
        await carregarAnuncios(); toast('Anúncio duplicado.');
      } else if (acao === 'apagar') {
        if (!confirm(`Excluir “${a.nome}”? Não dá para desfazer.`)) return;
        await api(`/anuncios/${id}`, { method: 'DELETE' });
        if (estado.editandoId === id) { preencherFormulario(null); definirEdicao(null); }
        await carregarAnuncios(); toast('Anúncio excluído.');
      }
    } catch (err) { toast(err.message, true); }
  });

  $('#abrir-config').addEventListener('click', () => {
    const f = $('#form-config');
    for (const k of Object.keys(TAXAS_PADRAO)) f.elements[k].value = paraTexto(estado.taxas[k]) || '0';
    $('#config').showModal();
  });
  $('#config').addEventListener('close', async () => {
    if ($('#config').returnValue !== 'salvar') return;
    const f = $('#form-config');
    const novas = Object.fromEntries(Object.keys(TAXAS_PADRAO).map((k) => [k, f.elements[k].value]));
    try {
      estado.taxas = await api('/config', { method: 'PUT', body: novas });
      renderAvisoCpf(); renderResultado(); toast('Taxas atualizadas.');
    } catch (err) { toast(err.message, true); }
  });
}

async function salvar() {
  const nome = $('#nome').value.trim();
  if (!nome) { $('#nome').focus(); return toast('Dê um nome ao anúncio.', true); }
  if (estado.resultado?.erro) return toast(estado.resultado.erro, true);
  const corpo = { ...lerEntrada(), nome, comentario: $('#comentario').value, tags: estado.tags, imagem: estado.imagem };
  const pendente = $('#tag-input').value.trim();
  if (pendente && !corpo.tags.includes(pendente)) corpo.tags = [...corpo.tags, pendente];

  const btn = $('#salvar'); btn.disabled = true;
  try {
    const salvo = estado.editandoId
      ? await api(`/anuncios/${estado.editandoId}`, { method: 'PUT', body: corpo })
      : await api('/anuncios', { method: 'POST', body: corpo });
    toast(estado.editandoId ? 'Anúncio atualizado.' : 'Anúncio salvo.');
    $('#tag-input').value = '';
    preencherFormulario(null);
    definirEdicao(null);
    await carregarAnuncios();
    document.querySelector(`.item[data-id="${salvo.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
  }
}

// Reduz a foto para no máx. 320px (JPEG) antes de ir para o banco.
function reduzirImagem(arquivo, lado = 320) {
  return new Promise((ok, falha) => {
    const img = new Image();
    img.onload = () => {
      const esc = Math.min(1, lado / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * esc); c.height = Math.round(img.height * esc);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      ok(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = falha;
    img.src = URL.createObjectURL(arquivo);
  });
}

async function iniciar() {
  ligarEventos();
  $('#sair').addEventListener('click', async () => {
    try { await api('/auth/logout', { method: 'POST' }); } finally { location.replace('/login.html'); }
  });
  try {
    const loja = await api('/auth/eu');
    $('#loja-nome').textContent = loja.nome;
    $('#loja-nome').title = loja.email;
  } catch { return; }
  try { estado.taxas = await api('/config'); } catch { toast('Servidor indisponível — usando taxas padrão.', true); }
  preencherFormulario(null);
  definirEdicao(null);
  try { await carregarAnuncios(); } catch (err) { toast(err.message, true); }
}

iniciar();
