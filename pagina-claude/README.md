# Página do claude.ai (Algoritmo Custos)

Versão principal em uso: uma página única publicada no claude.ai, com banco de dados
próprio (lojas, anúncios, taxas travadas para o dono e solicitações de alteração).

- `template.html`: estrutura e estilos
- `app.js`: comportamento da página (lojas, anúncios, gráfico, simulador, permissões)
- `../public/calc.js`: motor de cálculo, o mesmo usado pela versão com servidor e pelos testes

Para gerar o HTML final: `python3 pagina-claude/montar.py`
