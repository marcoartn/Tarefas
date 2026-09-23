"""Monta a página publicada no claude.ai (Algoritmo Custos) num único HTML.

Junta template.html + o motor de cálculo compartilhado (../public/calc.js, sem os
`export`) + app.js e grava algoritmo-custos.html ao lado deste arquivo.

    python3 pagina-claude/montar.py
"""
import re
from pathlib import Path

aqui = Path(__file__).parent
calc = re.sub(r'^export ', '', (aqui.parent / 'public' / 'calc.js').read_text(), flags=re.M)
html = (aqui / 'template.html').read_text().replace('/*CALC*/', calc).replace('/*APP*/', (aqui / 'app.js').read_text())
(aqui / 'algoritmo-custos.html').write_text(html)
print(f'ok: {aqui / "algoritmo-custos.html"} ({len(html) // 1024} KB)')
