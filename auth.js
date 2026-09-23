import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const CUSTO = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const DURACAO_SESSAO_DIAS = 30;

export async function gerarHashSenha(senha) {
  const sal = randomBytes(16);
  const hash = await scryptAsync(senha.normalize('NFKC'), sal, 64, CUSTO);
  return `scrypt$${sal.toString('base64')}$${hash.toString('base64')}`;
}

export async function conferirSenha(senha, armazenado) {
  const [alg, salB64, hashB64] = String(armazenado).split('$');
  if (alg !== 'scrypt' || !salB64 || !hashB64) return false;
  const esperado = Buffer.from(hashB64, 'base64');
  const hash = await scryptAsync(senha.normalize('NFKC'), Buffer.from(salB64, 'base64'), esperado.length, CUSTO);
  return timingSafeEqual(hash, esperado);
}

export const novoToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token) => createHash('sha256').update(token).digest('hex');

// Hash fixo usado quando o email não existe, para o login levar o mesmo tempo
// e não entregar quais emails estão cadastrados.
export const HASH_FALSO = 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');

// Limite de tentativas de login por IP + email (em memória).
export function criarLimitador({ maxFalhas = 8, janelaMs = 15 * 60 * 1000 } = {}) {
  const falhas = new Map();
  const limpar = (agora) => { for (const [k, v] of falhas) if (agora - v.inicio > janelaMs) falhas.delete(k); };
  return {
    bloqueado(chave) {
      const agora = Date.now(); limpar(agora);
      return (falhas.get(chave)?.n ?? 0) >= maxFalhas;
    },
    falhou(chave) {
      const agora = Date.now();
      const f = falhas.get(chave);
      if (!f || agora - f.inicio > janelaMs) falhas.set(chave, { n: 1, inicio: agora });
      else f.n++;
    },
    sucesso(chave) { falhas.delete(chave); },
  };
}
