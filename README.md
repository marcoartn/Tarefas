# Tarefas

CLI simples para gerenciar tarefas, feita em Python (só biblioteca padrão).

As tarefas ficam salvas em `~/.tarefas.json`.

## Uso

```
python3 tarefas.py add "Comprar leite" --priority alta --due 2026-09-20
python3 tarefas.py list
python3 tarefas.py list --status pending
python3 tarefas.py done 1
python3 tarefas.py edit 1 --title "Comprar leite e pão"
python3 tarefas.py remove 1
```

## Testes

```
python3 -m pytest tests/
```
