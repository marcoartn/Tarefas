# PrecificaShop — calculadora de preço para Shopee

Calculadora de precificação com anúncios salvos em banco de dados **SQLite** (arquivo local).
Não depende de nenhum pacote externo: só precisa do **Node.js 22.5+**.

```bash
npm start          # http://localhost:3000
npm test           # testes do cálculo e da API
```

O banco fica em `data/precificador.db` (mude com `DB_PATH=...`, e a porta com `PORT=...`).
Para fazer backup, basta copiar esse arquivo.

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
| `db.js` | Esquema SQLite (`anuncios`, `anuncio_tags`, `config`) |
| `repo.js` | Validação, recálculo e consultas |
| `server.js` | API REST + arquivos estáticos |
| `public/` | Interface (HTML/CSS/JS puro) |

### API

`GET/POST /api/anuncios` · `GET/PUT/DELETE /api/anuncios/:id` · `POST /api/anuncios/:id/duplicar` ·
`GET /api/tags` · `GET/PUT /api/config`
