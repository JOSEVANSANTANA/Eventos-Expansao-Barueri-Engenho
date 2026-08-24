#!/usr/bin/env python3
"""Gera a versao de arquivo unico, para abrir com duplo clique.
Rode depois de qualquer alteracao:  python3 build-standalone.py"""
import pathlib

base = pathlib.Path(__file__).parent
html = (base / 'index.html').read_text(encoding='utf-8')
css = (base / 'css' / 'app.css').read_text(encoding='utf-8')
ordem = ['knowledge', 'config', 'data', 'prompts', 'openrouter', 'teleprompter', 'app']
js = {n: (base / 'js' / f'{n}.js').read_text(encoding='utf-8') for n in ordem}

html = html.replace('<link rel="stylesheet" href="css/app.css">', '<style>\n' + css + '\n</style>')
html = html.replace('<link rel="manifest" href="manifest.json">', '<!-- standalone: sem manifest -->')

tags = '\n'.join(f'<script src="js/{n}.js"></script>' for n in ordem)
if tags not in html:
    raise SystemExit('ERRO: bloco de <script> nao encontrado em index.html')
corpo = '\n\n'.join(f'/* ===== {n}.js ===== */\n' + js[n] for n in ordem)
html = html.replace(tags, '<script>\n' + corpo + '\n</script>')

saida = base / 'Radar-Institucional-STANDALONE.html'
saida.write_text(html, encoding='utf-8')
print(f'gerado: {saida.name}  ({saida.stat().st_size/1024:.1f} KB)')
