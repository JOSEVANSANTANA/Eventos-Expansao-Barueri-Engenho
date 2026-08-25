#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
RADAR INSTITUCIONAL - servidor local

Serve a ferramenta E colhe noticia real. Existe por um motivo especifico:
nenhum feed de noticia brasileiro libera CORS, entao o navegador nao consegue
le-los sozinho. Este servidor busca do lado de ca, onde CORS nao se aplica, e
entrega ja processado.

Sem dependencia externa: so a biblioteca padrao do Python 3.
Uso:  python3 servidor.py  [porta]
"""

import json
import re
import sys
import unicodedata
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, quote
from urllib.request import Request, urlopen

PORTA_PADRAO = 8080
UA = 'Mozilla/5.0 (compatible; RadarInstitucional/1.0)'

# --------------------------------------------------------------------------
# FONTES
# --------------------------------------------------------------------------

# Consultas no Google News. Sao elas que definem a largura do leque - cada uma
# vira uma frente de pauta diferente. Mexer aqui muda o que a ferramenta enxerga.
CONSULTAS = [
    ('macro',      'Selic OR Copom OR "taxa de juros" Banco Central'),
    ('inflacao',   'IPCA OR inflação OR "custo de vida" Brasil'),
    ('bolsa',      'Ibovespa OR "bolsa de valores" OR B3 ações'),
    ('cambio',     'dólar OR câmbio OR "moeda estrangeira" Brasil'),
    ('tributos',   '"imposto de renda" OR "reforma tributária" OR tributação investimentos'),
    ('dividendos', 'dividendos OR "juros sobre capital próprio" tributação'),
    ('imoveis',    '"financiamento imobiliário" OR "crédito imobiliário" OR "fundos imobiliários"'),
    ('credito',    '"crédito com garantia" OR endividamento OR "cheque especial" OR inadimplência'),
    ('previdencia','previdência OR aposentadoria OR INSS reforma'),
    ('cripto',     'bitcoin OR criptomoedas OR "ativos digitais" regulação Brasil'),
    ('empresas',   'balanço OR lucro OR "resultado trimestral" empresa brasileira'),
    ('fiscal',     '"dívida pública" OR "déficit fiscal" OR "arcabouço fiscal" Brasil'),
    ('protecao',   'seguro OR consórcio OR "planejamento sucessório" OR herança'),
    ('global',     'Federal Reserve OR "juros americanos" OR "economia global" impacto Brasil'),
]

# Veiculos com feed proprio: pegam pauta que a consulta por termo perde.
FEEDS_DIRETOS = [
    ('InfoMoney',   'https://www.infomoney.com.br/feed/'),
    ('Money Times', 'https://www.moneytimes.com.br/feed/'),
    ('Seu Dinheiro','https://www.seudinheiro.com/feed/'),
    ('Exame Invest','https://exame.com/invest/feed/'),
]

TRENDS_BR = 'https://trends.google.com/trending/rss?geo=BR'

def url_news(consulta):
    return ('https://news.google.com/rss/search?q=' + quote(consulta)
            + '&hl=pt-BR&gl=BR&ceid=BR:pt-419')

# --------------------------------------------------------------------------
# LEITURA E PARSE
# --------------------------------------------------------------------------

def baixar(url, timeout=18):
    req = Request(url, headers={'User-Agent': UA, 'Accept': 'application/rss+xml, application/xml, text/xml, */*'})
    with urlopen(req, timeout=timeout) as r:
        bruto = r.read()
    for cod in ('utf-8', 'latin-1'):
        try:
            return bruto.decode(cod)
        except UnicodeDecodeError:
            continue
    return bruto.decode('utf-8', 'ignore')

def _tag(bloco, nome):
    m = re.search(r'<%s[^>]*>(.*?)</%s>' % (nome, nome), bloco, re.S)
    return m.group(1).strip() if m else ''

def limpar(txt):
    txt = re.sub(r'<!\[CDATA\[(.*?)\]\]>', r'\1', txt, flags=re.S)
    txt = re.sub(r'<[^>]+>', ' ', txt)
    subs = {'&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
            '&#39;': "'", '&apos;': "'", '&nbsp;': ' ', '&#8217;': '’'}
    for k, v in subs.items():
        txt = txt.replace(k, v)
    txt = re.sub(r'&#(\d+);', lambda m: chr(int(m.group(1))), txt)
    return re.sub(r'\s+', ' ', txt).strip()

def quando(bloco):
    bruto = _tag(bloco, 'pubDate') or _tag(bloco, 'dc:date')
    if not bruto:
        return None
    try:
        d = parsedate_to_datetime(limpar(bruto))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except Exception:
        return None

def dominio(url):
    try:
        h = urlparse(url).netloc.lower()
        return h[4:] if h.startswith('www.') else h
    except Exception:
        return ''

def ler_noticias(xml, frente, veiculo_fixo=None):
    saida = []
    for bloco in re.findall(r'<item[^>]*>(.*?)</item>', xml, re.S):
        titulo = limpar(_tag(bloco, 'title'))
        if not titulo:
            continue
        link = limpar(_tag(bloco, 'link'))
        # O Google News poe " - Veiculo" no fim do titulo.
        veiculo = veiculo_fixo
        if not veiculo and ' - ' in titulo:
            partes = titulo.rsplit(' - ', 1)
            if len(partes[1]) < 45:
                titulo, veiculo = partes[0].strip(), partes[1].strip()
        d = quando(bloco)
        saida.append({
            'titulo': titulo,
            'url': link,
            'veiculo': veiculo or dominio(link) or 'desconhecido',
            'data': d.isoformat() if d else None,
            'horas': round((datetime.now(timezone.utc) - d).total_seconds() / 3600, 1) if d else None,
            'frente': frente,
        })
    return saida

def ler_trends(xml):
    saida = []
    for bloco in re.findall(r'<item>(.*?)</item>', xml, re.S):
        termo = limpar(_tag(bloco, 'title'))
        if not termo:
            continue
        trafego = limpar(_tag(bloco, 'ht:approx_traffic')) or '0'
        n = int(re.sub(r'[^\d]', '', trafego) or 0)
        manchetes = [limpar(t) for t in re.findall(
            r'<ht:news_item_title>(.*?)</ht:news_item_title>', bloco, re.S)]
        saida.append({'termo': termo, 'trafego': n, 'trafegoTexto': trafego,
                      'manchetes': manchetes[:3]})
    return saida

# --------------------------------------------------------------------------
# TERMOMETRO - medido, nao opinado
# --------------------------------------------------------------------------

STOPWORDS = set("""
a o e de da do das dos em no na nos nas um uma uns umas para por com sem sob
sobre entre ate apos que se ao aos as os e ou mas nem como quando onde qual
quais quanto seu sua seus suas este esta isso aquele aquela ser estar ter haver
foi sao era mais menos muito pouco ja nao sim tambem apenas ainda depois antes
hoje ontem amanha agora vai vao pode podem deve devem fez fazer diz dizem apos
brasil brasileiro brasileira news veja saiba entenda confira leia opiniao
r$ us$ mil milhoes bilhoes ano anos mes meses dia dias
mercado mercados economia economico economica financeiro financeira financas
investimento investimentos investidor investidores dinheiro real reais
ponto pontos taxa taxas nivel setor pais governo federal nacional
noticia noticias analise dados numero numeros semana segunda terca quarta
quinta sexta sabado domingo manha tarde noite fechamento abertura
2024 2025 2026 2027 2028
banco bancos central bolsa risco riscos queda quedas alta altas sobe cai caiu subiu
resultado resultados projecao projecoes expectativa expectativas
""".split())

# Palavras que sinalizam atrito. Conteudo com atrito circula mais - e o unico
# componente do termometro que mede tensao, nao volume.
LEXICO_ATRITO = set("""
alta queda despenca dispara salta tomba risco perigo alerta ameaca crise
polemica critica ataca acusa nega processo investigacao fraude golpe rombo
prejuizo perda calote inadimplencia corte aumento imposto taxacao tributacao
proibicao veto derrota vitoria recorde historico inedito choque surpresa
susto medo panico euforia bolha estouro colapso quebra falencia
""".split())

def normalizar(txt):
    t = unicodedata.normalize('NFD', txt.lower())
    t = ''.join(c for c in t if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^a-z0-9\s]', ' ', t)

def termos(titulo):
    """Palavras significativas de um titulo, ja normalizadas."""
    return [p for p in normalizar(titulo).split()
            if len(p) > 3 and p not in STOPWORDS and not p.isdigit()]

def chaves(titulo):
    """Assuntos candidatos de um titulo.

    Usa BIGRAMAS, nao palavras soltas. "credito" e vocabulario do setor e
    aparece em tudo; "credito consignado" e assunto. Palavra sozinha so entra
    se for rara o bastante para carregar significado por si (ver corte por
    frequencia em agrupar).
    """
    ts = termos(titulo)
    bi = [f'{a} {b}' for a, b in zip(ts, ts[1:])]
    return bi, ts

def peso_recencia(horas):
    if horas is None:
        return 0.6
    if horas <= 6:
        return 3.0
    if horas <= 24:
        return 2.0
    if horas <= 72:
        return 1.0
    return 0.35

# Acima desta fracao do total de manchetes, o termo deixou de ser assunto e
# virou pano de fundo. "mercado" aparece em 40% das materias de economia -
# isso nao e pauta, e o nome da editoria.
TETO_FREQUENCIA = 0.14
MIN_MANCHETES = 3

# Uma palavra que encabeca muitos bigramas diferentes ("juros" puxa alta juros,
# corte juros, juros altos...) e categoria, nao assunto. Medido, nao arbitrado.
MAX_BIGRAMAS_POR_CABECA = 3

def agrupar(noticias, trends, minimo=MIN_MANCHETES):
    """Agrupa manchetes por assunto e mede a temperatura de cada grupo.

    Duas passadas: a primeira descobre quais palavras sao cabeca de categoria,
    a segunda monta os grupos ja sem elas.
    """
    total = len(noticias) or 1

    # --- passada 1: frequencia de bigramas e quem os encabeca ---------------
    freqBigrama = defaultdict(int)
    for n in noticias:
        bi, _ = chaves(n['titulo'])
        for b in set(bi):
            freqBigrama[b] += 1

    cabecas = defaultdict(set)
    for b, f in freqBigrama.items():
        if f < minimo:
            continue
        a, c = b.split(' ', 1)
        cabecas[a].add(b)
        cabecas[c].add(b)
    categorias = {w for w, bs in cabecas.items() if len(bs) >= MAX_BIGRAMAS_POR_CABECA}

    # --- passada 2: monta os grupos ----------------------------------------
    porChave = defaultdict(list)
    for n in noticias:
        bi, uni = chaves(n['titulo'])
        candidatos = set(bi) | {u for u in uni if u not in categorias}
        for c in candidatos:
            porChave[c].append(n)

    trendsNorm = {normalizar(t['termo']): t for t in trends}

    grupos = []
    for chave, itens in porChave.items():
        if len(itens) < minimo:
            continue

        freq = len(itens) / total
        ehBigrama = ' ' in chave
        if freq > TETO_FREQUENCIA:
            continue
        if not ehBigrama and freq > TETO_FREQUENCIA * 0.45:
            continue

        veiculos = {i['veiculo'] for i in itens}
        frentes = {i['frente'] for i in itens}
        recencia = sum(peso_recencia(i['horas']) for i in itens)
        recentes6h = sum(1 for i in itens if i['horas'] is not None and i['horas'] <= 6)
        atrito = sum(len(set(termos(i['titulo'])) & LEXICO_ATRITO) for i in itens)

        trafego = 0
        partesChave = set(chave.split())
        for tn, t in trendsNorm.items():
            if partesChave & set(tn.split()):
                trafego = max(trafego, t['trafego'])

        grupos.append({
            'termo': chave,
            'bigrama': ehBigrama,
            'volume': len(itens),
            'veiculos': len(veiculos),
            'listaVeiculos': sorted(veiculos)[:8],
            'frentes': sorted(frentes),
            'recencia': round(recencia, 1),
            'recentes6h': recentes6h,
            'atrito': atrito,
            'trafegoBusca': trafego,
            'raridade': round((1 - freq / TETO_FREQUENCIA) * 100),
            'manchetes': [
                {'titulo': i['titulo'], 'veiculo': i['veiculo'], 'url': i['url'],
                 'horas': i['horas'], 'frente': i['frente']}
                for i in sorted(itens, key=lambda x: (x['horas'] is None, x['horas'] or 999))[:6]
            ],
        })

    if not grupos:
        return []

    def maxde(c):
        return max((g[c] for g in grupos), default=0) or 1

    mv, mvei, mrec, matr, mtra = (maxde('volume'), maxde('veiculos'),
                                  maxde('recencia'), maxde('atrito'), maxde('trafegoBusca'))

    for g in grupos:
        amplitude = g['veiculos'] / mvei      # em quantos veiculos diferentes bateu
        volume = g['volume'] / mv              # quantas materias
        velocidade = g['recencia'] / mrec      # quao recente
        tensao = g['atrito'] / matr if matr else 0
        busca = g['trafegoBusca'] / mtra if mtra else 0

        nota = (amplitude * 28 + velocidade * 26 + volume * 16
                + tensao * 16 + busca * 8)
        if len(g['frentes']) > 1:
            nota += 6
        if g['bigrama']:
            nota += 6

        g['temperatura'] = max(0, min(100, round(nota)))
        g['componentes'] = {
            'amplitude': round(amplitude * 100),
            'velocidade': round(velocidade * 100),
            'volume': round(volume * 100),
            'tensao': round(tensao * 100),
            'busca': round(busca * 100),
        }

    grupos.sort(key=lambda g: -g['temperatura'])

    finais, vistos = [], []
    for g in grupos:
        titulos = {m['titulo'] for m in g['manchetes']}
        if any(len(titulos & v) >= max(2, len(titulos) * 0.5) for v in vistos):
            continue
        vistos.append(titulos)
        finais.append(g)
        if len(finais) >= 22:
            break
    return finais

# --------------------------------------------------------------------------
# COLETA
# --------------------------------------------------------------------------

# Coleta e cara (19 fontes) e o conteudo nao muda de minuto em minuto.
# O termometro e a varredura pedem em sequencia - sem cache, colheria duas vezes.
_cache = {'em': 0, 'dados': None}
VALIDADE_CACHE = 300  # segundos

def coletar(forcar=False):
    import time as _t
    if not forcar and _cache['dados'] and (_t.time() - _cache['em']) < VALIDADE_CACHE:
        d = dict(_cache['dados'])
        d['doCache'] = True
        d['idadeCache'] = round(_t.time() - _cache['em'])
        return d

    tarefas = [('news', f, url_news(q)) for f, q in CONSULTAS]
    tarefas += [('feed', nome, url) for nome, url in FEEDS_DIRETOS]
    tarefas += [('trends', 'trends', TRENDS_BR)]

    noticias, trends, falhas = [], [], []

    def puxar(t):
        tipo, rot, url = t
        try:
            return tipo, rot, baixar(url), None
        except Exception as e:
            return tipo, rot, None, f'{rot}: {type(e).__name__}'

    with ThreadPoolExecutor(max_workers=10) as pool:
        for tipo, rot, xml, erro in pool.map(puxar, tarefas):
            if erro:
                falhas.append(erro)
                continue
            if tipo == 'trends':
                trends = ler_trends(xml)
            elif tipo == 'news':
                noticias += ler_noticias(xml, rot)
            else:
                noticias += ler_noticias(xml, 'veiculo', veiculo_fixo=rot)

    # Mesma materia chega por varias consultas: mantem uma so.
    unicas, vistos = [], set()
    for n in noticias:
        chave = normalizar(n['titulo'])[:90]
        if chave in vistos:
            continue
        vistos.add(chave)
        unicas.append(n)

    grupos = agrupar(unicas, trends)

    resultado = {
        'coletadoEm': datetime.now(timezone.utc).isoformat(),
        'totalManchetes': len(unicas),
        'fontesConsultadas': len(tarefas),
        'falhas': falhas,
        'trends': trends[:20],
        'assuntos': grupos,
        'frentes': sorted({n['frente'] for n in unicas}),
        'doCache': False,
    }
    import time as _t
    _cache['em'], _cache['dados'] = _t.time(), resultado
    return resultado

# --------------------------------------------------------------------------
# SERVIDOR
# --------------------------------------------------------------------------

class Handler(SimpleHTTPRequestHandler):
    def log_message(self, formato, *args):
        if '/api/' in (args[0] if args else ''):
            sys.stderr.write("  coleta solicitada\n")

    def _json(self, obj, status=200):
        corpo = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)

    def do_GET(self):
        caminho = urlparse(self.path).path
        if caminho == '/api/status':
            return self._json({'ok': True, 'servidor': 'Radar Institucional',
                               'consultas': len(CONSULTAS), 'feeds': len(FEEDS_DIRETOS)})
        if caminho == '/api/coleta':
            try:
                q = parse_qs(urlparse(self.path).query)
                return self._json(coletar(forcar=q.get('forcar', ['0'])[0] == '1'))
            except Exception as e:
                return self._json({'erro': f'{type(e).__name__}: {e}'}, 500)
        return super().do_GET()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.end_headers()

def main():
    porta = int(sys.argv[1]) if len(sys.argv) > 1 else PORTA_PADRAO
    srv = ThreadingHTTPServer(('127.0.0.1', porta), Handler)
    print()
    print('  ================================================')
    print('   RADAR INSTITUCIONAL')
    print('  ================================================')
    print()
    print(f'   Aberto em:  http://localhost:{porta}')
    print(f'   Coletor:    {len(CONSULTAS)} consultas + {len(FEEDS_DIRETOS)} veiculos + Google Trends')
    print()
    print('   NAO FECHE ESTA JANELA enquanto estiver usando.')
    print('   Ctrl+C encerra.')
    print()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print('\n  Encerrado.\n')

if __name__ == '__main__':
    main()
