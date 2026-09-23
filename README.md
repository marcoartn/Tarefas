# PrecificaShop — calculadora de preço para Shopee

Calculadora de precificação com anúncios salvos em banco de dados **SQLite** (arquivo local).
Não depende de nenhum pacote externo: só precisa do **Node.js 22.13+**.

```bash
npm start          # http://localhost:3000
npm test           # testes do cálculo e da API
```

O banco fica em `data/precificador.db` (mude com `DB_PATH=...`, e a porta com `PORT=...`).
Para fazer backup, basta copiar esse arquivo.

## Contas das lojas

Cada loja cria sua conta (nome, email e senha) em `/login.html` e só enxerga os **próprios** anúncios, tags e taxas.

- Senhas guardadas com **scrypt** + sal (nunca em texto puro).
- Sessão em cookie `HttpOnly` / `SameSite=Lax` válido por 30 dias. No banco fica só o hash do token.
- Máximo de 8 tentativas de login erradas a cada 15 minutos por IP + email.
- Toda escrita na API exige `Content-Type: application/json` (proteção contra CSRF).
- **Esqueci a senha:** ainda não há envio de email. Quem administra o servidor redefine pelo terminal:

  ```bash
  npm run senha -- email@loja.com novaSenha123
  ```
  Isso também desconecta a loja de todos os aparelhos.

Se você já usava a versão sem contas, os anúncios existentes vão para a **primeira loja cadastrada**.

> Em produção, rode atrás de HTTPS (Render, Railway, VPS com Caddy/Nginx). Sem HTTPS a senha trafega em texto aberto.

## O que faz

- **Vendedor CPF/CNPJ**: a taxa extra por item do CPF entra sozinha.
- **Custo do produto × quantidade** (kits), imposto %, custos variáveis e **custos extras** (em R$ ou em %, ex.: Shopee Ads).
- **3 modos**: por margem, por preço de venda ou por lucro desejado.
- Detalhamento de custos com barra proporcional, lucro líquido, margem real e markup.
- **Teto da comissão** por item aplicado automaticamente em produtos caros.
- Anúncios salvos com foto, comentário e tags. Dá para buscar, filtrar por tag (**Contém** = tem todas as marcadas; **Somente** = exatamente as marcadas), ver em lista ou grade, editar, duplicar e excluir.
- **Taxas editáveis** (botão ⚙ Taxas). As regras da Shopee mudam, então confira na Central do Vendedor.

## Os dados salvos estão corretos?

O servidor **nunca confia nos números enviados pelo navegador**: a cada salvamento ele recalcula tudo
com o mesmo código da tela (`public/calc.js`) e grava as entradas, **as taxas daquele momento** e os resultados.
O preço é arredondado para cima no centavo até o lucro real atingir o que foi pedido.

## Estrutura

| Arquivo | Função |
|---|---|
| `public/calc.js` | Motor de cálculo (usado no navegador e no servidor) |
| `db.js` | Esquema SQLite (`lojas`, `sessoes`, `anuncios`, `anuncio_tags`) |
| `auth.js` | Hash de senha, tokens de sessão e limite de tentativas |
| `repo.js` | Contas, validação, recálculo e consultas presas à loja |
| `trocar-senha.js` | Redefinição de senha pelo terminal |
| `server.js` | API REST + arquivos estáticos |
| `public/` | Interface (HTML/CSS/JS puro) |

### API

`POST /api/auth/cadastro` · `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/eu`

Rotas abaixo exigem login (respondem 401 sem sessão):

`GET/POST /api/anuncios` · `GET/PUT/DELETE /api/anuncios/:id` · `POST /api/anuncios/:id/duplicar` ·
`GET /api/tags` · `GET/PUT /api/config`
