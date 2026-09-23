const $ = (s, el = document) => el.querySelector(s);

async function enviar(caminho, corpo) {
  const res = await fetch(`/api/auth/${caminho}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  const dados = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(dados.erro || 'Não foi possível continuar. Tente de novo.');
  return dados;
}

function trocarAba(aba) {
  document.querySelectorAll('[data-aba]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.aba === aba)));
  $('#form-entrar').hidden = aba !== 'entrar';
  $('#form-cadastro').hidden = aba !== 'cadastro';
  $(aba === 'entrar' ? '#entrar-email' : '#cad-nome').focus();
  history.replaceState(null, '', aba === 'cadastro' ? '#cadastro' : location.pathname);
}

function mostrarErro(form, msg) {
  const el = $('.erro', form);
  el.textContent = msg; el.hidden = !msg;
}

async function aoEnviar(form, validar, caminho) {
  mostrarErro(form, '');
  const dados = Object.fromEntries(new FormData(form));
  const problema = validar(dados);
  if (problema) return mostrarErro(form, problema);
  const btn = $('button[type=submit]', form);
  btn.disabled = true;
  try {
    await enviar(caminho, dados);
    location.replace('/');
  } catch (err) {
    mostrarErro(form, err.message);
    btn.disabled = false;
  }
}

document.querySelectorAll('[data-aba]').forEach((b) => b.addEventListener('click', () => trocarAba(b.dataset.aba)));

document.querySelectorAll('.ver-senha').forEach((b) => b.addEventListener('click', () => {
  const input = b.previousElementSibling;
  const mostrar = input.type === 'password';
  input.type = mostrar ? 'text' : 'password';
  b.textContent = mostrar ? 'Ocultar' : 'Ver';
  b.setAttribute('aria-label', mostrar ? 'Ocultar senha' : 'Mostrar senha');
}));

$('#form-entrar').addEventListener('submit', (e) => {
  e.preventDefault();
  aoEnviar(e.target, (d) => (!d.email.trim() || !d.senha ? 'Preencha email e senha.' : null), 'login');
});

$('#form-cadastro').addEventListener('submit', (e) => {
  e.preventDefault();
  aoEnviar(e.target, (d) => {
    if (!d.nome.trim()) return 'Informe o nome da loja.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) return 'Informe um email válido.';
    if (d.senha.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
    if (d.senha !== d.senha2) return 'As senhas não conferem.';
    return null;
  }, 'cadastro');
});

if (location.hash === '#cadastro') trocarAba('cadastro');
