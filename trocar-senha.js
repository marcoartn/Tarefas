// Redefine a senha de uma loja pelo terminal:  npm run senha -- email@loja.com novaSenha123
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirBanco } from './db.js';
import { criarContas } from './repo.js';

const [email, senha] = process.argv.slice(2);
if (!email || !senha) {
  console.error('Uso: npm run senha -- email@loja.com novaSenha');
  process.exit(1);
}
const banco = process.env.DB_PATH || join(fileURLToPath(new URL('.', import.meta.url)), 'data', 'precificador.db');
try {
  const ok = await criarContas(abrirBanco(banco)).trocarSenha(email, senha);
  console.log(ok ? `Senha de ${email} alterada. Sessões abertas foram encerradas.` : `Nenhuma loja com o email ${email}.`);
  process.exit(ok ? 0 : 1);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
