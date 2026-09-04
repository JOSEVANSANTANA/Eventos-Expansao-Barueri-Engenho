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
import os
import re
import sys
import unicodedata
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, quote
from urllib.error import URLError
from urllib.request import Request, urlopen
import ssl
import subprocess
import threading

# Tudo que o servidor le e serve sai daqui, nunca do diretorio de trabalho:
# duplo clique costuma comecar com o CWD em outro lugar, principalmente no Windows.
RAIZ = os.path.dirname(os.path.abspath(__file__))

PORTA_PADRAO = 8080
UA = 'Mozilla/5.0 (compatible; RadarInstitucional/1.0)'

# --------------------------------------------------------------------------
# FONTES
# --------------------------------------------------------------------------

# Consultas no Google News Brasil. Cada uma e uma frente de pauta.
CONSULTAS_BR = [
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
    ('varejo',     '"poder de compra" OR "salário mínimo" OR emprego OR consumo Brasil'),
    ('regulacao',  'CVM OR Banco Central regulação mercado OR fintech Brasil'),
]

# Consultas no Google News internacional. O que move o mundo bate no Brasil
# com um ou dois dias de atraso - e quem noticia primeiro pega a onda.
CONSULTAS_INT = [
    ('global',     'Federal Reserve OR FOMC OR "interest rates" decision'),
    ('inflacaoUS', 'inflation OR CPI OR "consumer prices" United States'),
    ('mercadoUS',  'stock market OR "S&P 500" OR Nasdaq OR "Wall Street"'),
    ('geopolitica','oil prices OR commodities OR "trade war" OR tariffs economy'),
    ('bancosINT',  'ECB OR "central bank" OR recession OR "global economy"'),
    ('emergentes', 'emerging markets OR Brazil economy investors'),
]

# Sites sem feed aberto, alcancados via Google News.
VIA_GOOGLE_NEWS = [
    ('Reuters',   'site:reuters.com markets OR economy when:2d', 'en'),
    ('Bloomberg', 'site:bloomberg.com when:2d', 'en'),
    ('Financial Times', 'site:ft.com when:2d', 'en'),
    ('Valor Economico', 'site:valor.globo.com when:2d', 'pt'),
    ('CNN Brasil', 'site:cnnbrasil.com.br economia when:2d', 'pt'),
    ('Folha', 'site:folha.uol.com.br mercado OR economia when:2d', 'pt'),
]

# Veiculos com feed proprio. Testados um a um antes de entrar.
FEEDS_BR = [
    ('Folha Mercado',   'https://feeds.folha.uol.com.br/mercado/rss091.xml'),
    ('G1 Economia',     'https://g1.globo.com/rss/g1/economia/'),
    ('Estadao Economia','https://www.estadao.com.br/arc/outboundfeeds/feeds/rss/sections/economia/?outputType=xml'),
    ('InfoMoney',       'https://www.infomoney.com.br/feed/'),
    ('Money Times',     'https://www.moneytimes.com.br/feed/'),
    ('Seu Dinheiro',    'https://www.seudinheiro.com/feed/'),
    ('Exame Invest',    'https://exame.com/invest/feed/'),
    ('CVM',             'https://www.gov.br/cvm/pt-br/assuntos/noticias/RSS'),
]

FEEDS_INT = [
    ('New York Times',  'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml'),
    ('NYT Economy',     'https://rss.nytimes.com/services/xml/rss/nyt/Economy.xml'),
    ('CNBC',            'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664'),
    ('CNBC Economy',    'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258'),
    ('Yahoo Finance',   'https://finance.yahoo.com/news/rssindex'),
    ('Investing.com',   'https://www.investing.com/rss/news.rss'),
    ('Investing Economia','https://www.investing.com/rss/news_14.rss'),
    ('MarketWatch',     'https://feeds.content.dowjones.io/public/rss/mw_topstories'),
    ('WSJ Markets',     'https://feeds.content.dowjones.io/public/rss/RSSMarketsMain'),
    ('Federal Reserve', 'https://www.federalreserve.gov/feeds/press_monetary.xml'),
]

TRENDS = [
    ('Brasil', 'https://trends.google.com/trending/rss?geo=BR'),
    ('EUA',    'https://trends.google.com/trending/rss?geo=US'),
]

# Sem operador de tempo, o Google News devolve os melhores resultados de TODOS
# os tempos para a consulta - e esses nao mudam nunca. Medido: a consulta de
# tributos sem filtro trazia mediana de 98 dias de idade, com 1 item em 60 nas
# ultimas 24h. Com when:1d, 100% nas ultimas 24h. Era esta a razao de a
# ferramenta repetir as mesmas pautas dia apos dia.
JANELA_NOTICIA = 'when:2d'

def url_news(consulta, idioma='pt'):
    if 'when:' not in consulta:
        consulta = f'{consulta} {JANELA_NOTICIA}'
    if idioma == 'en':
        return ('https://news.google.com/rss/search?q=' + quote(consulta)
                + '&hl=en-US&gl=US&ceid=US:en')
    return ('https://news.google.com/rss/search?q=' + quote(consulta)
            + '&hl=pt-BR&gl=BR&ceid=BR:pt-419')

# --------------------------------------------------------------------------
# LEITURA E PARSE
# --------------------------------------------------------------------------

# Estado do SSL, descoberto na primeira falha e reaproveitado depois.
_fallback = {'curl': False}

def baixar(url, timeout=10):
    """Busca um feed. Tenta urllib; se falhar, cai para o curl do sistema.

    Motivo do curl: Python instalado do python.org no macOS nao usa o chaveiro
    do sistema e falha em TODA conexao https ate rodar
    "Install Certificates.command" - o que derruba a coleta inteira de uma vez.
    O curl do macOS usa o chaveiro e funciona sempre. Em vez de exigir que o
    usuario conserte o Python, a gente usa a ferramenta que ja funciona.
    """
    cabecalhos = {
        'User-Agent': UA,
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
    }

    # 1) urllib com verificacao normal
    try:
        req = Request(url, headers=cabecalhos)
        with urlopen(req, timeout=timeout, context=ssl.create_default_context()) as r:
            return _decodificar(r.read())
    except Exception as e:
        erroUrllib = e

    # 2) curl do sistema
    try:
        saida = subprocess.run(
            ['curl', '-sS', '--fail', '--location', '--max-time', str(timeout),
             '-A', UA, '-H', 'Accept: application/rss+xml, application/xml, */*', url],
            capture_output=True, timeout=timeout + 5)
        if saida.returncode == 0 and saida.stdout:
            _fallback['curl'] = True
            return _decodificar(saida.stdout)
        detalheCurl = (saida.stderr or b'').decode('utf-8', 'ignore')[:120]
    except FileNotFoundError:
        detalheCurl = 'curl nao encontrado neste sistema'
    except Exception as e:
        detalheCurl = f'{type(e).__name__}: {e}'[:120]

    raise RuntimeError(f'urllib: {type(erroUrllib).__name__}: {erroUrllib} | curl: {detalheCurl}')

def _decodificar(bruto):
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

# Nomes de veiculo aparecem no titulo e viravam "assunto" (valor, financial,
# bloomberg, paulo...). Entram como stopword para nunca serem pauta.
VEICULOS_CONHECIDOS = set()

def registrarVeiculo(nome):
    if not nome:
        return
    for parte in normalizar(nome).split():
        if len(parte) > 2:
            VEICULOS_CONHECIDOS.add(parte)

def ler_noticias(xml, frente, veiculo_fixo=None, idioma='pt'):
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
        registrarVeiculo(veiculo)

        # Fora de financas nao interessa: os feeds gerais e as consultas por
        # site trazem policia, futebol e transito junto.
        if not ehFinanceira(titulo):
            continue

        d = quando(bloco)
        saida.append({
            'titulo': titulo,
            'url': link,
            'veiculo': veiculo or dominio(link) or 'desconhecido',
            'data': d.isoformat() if d else None,
            'horas': round((datetime.now(timezone.utc) - d).total_seconds() / 3600, 1) if d else None,
            'frente': frente,
            'idioma': idioma,
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
        # Trends traz de tudo: novela, loteria, futebol. So o que e financeiro
        # tem valor aqui - o resto vira ruido no termometro.
        contexto = termo + ' ' + ' '.join(manchetes)
        if len(set(normalizar(contexto).split()) & LEXICO_FINANCA) < 2:
            continue
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
janeiro fevereiro marco abril maio junho julho agosto setembro outubro novembro dezembro
january february march april june july august september october november december
higher lower growth rising falling gains losses ahead amid despite after before
today yesterday tomorrow morning session close open futures
the and for with from that this what when where which will would could should
have has had been being are was were says said say new news more most than
about after before over under into out off down here there they them their
market markets economy economic stock stocks share shares price prices rate rates
report reports data year years week weeks day days time percent billion million
top best worst why how live update updates analysis opinion read watch
muda mudar vira virar deve devera pode podera fica ficar vagas feirao
investors investor traders trader analysts analysts week month quarter
resultado resultados projecao projecoes expectativa expectativas
""".split())

# Uma manchete so entra na analise se falar de dinheiro. Sem isso, as
# consultas por site e os feeds gerais trazem policia, futebol e metro junto.
LEXICO_FINANCA = set("""
juros selic copom inflacao ipca igpm cambio dolar euro real moeda
bolsa ibovespa acao acoes bovespa nasdaq indice dividendos acionista
banco bancos bancario credito financiamento emprestimo divida endividamento
inadimplencia consignado hipoteca imobiliario imovel imoveis aluguel
imposto tributo tributacao tributaria fisco receita arrecadacao itcmd
irpf declaracao isencao aliquota
investimento investidor carteira renda fundo fundos etf tesouro cdb lci lca
poupanca previdencia aposentadoria inss pgbl vgbl
economia economico pib fiscal deficit superavit orcamento gasto gastos
salario emprego desemprego consumo varejo industria comercio
lucro prejuizo balanco receita faturamento margem ebitda
bitcoin cripto criptomoeda blockchain stablecoin
seguro seguradora consorcio sucessao heranca inventario holding
fed fomc central copom bce boe pboc
mercado mercados financeiro financeira financas
empresa empresas companhia negocio negocios startup fintech
petroleo commodities minerio soja ouro
tarifa tarifas comercio importacao exportacao
inflation interest rate rates fed federal reserve treasury bond bonds yield
stock stocks market markets equity equities nasdaq dow jones
bank banks banking credit debt loan mortgage lending
tax taxes taxation fiscal deficit budget spending
investor investors fund funds etf portfolio dividend dividends
economy economic gdp recession growth inflation cpi ppi jobs unemployment
earnings profit revenue margin guidance
crypto bitcoin ethereum stablecoin
oil gold commodity commodities tariff tariffs trade
insurance pension retirement wealth
""".split())

def ehFinanceira(titulo):
    return bool(set(normalizar(titulo).split()) & LEXICO_FINANCA)

# Palavras que sinalizam atrito. Conteudo com atrito circula mais - e o unico
# componente do termometro que mede tensao, nao volume.
LEXICO_ATRITO = set("""
alta queda despenca dispara salta tomba risco perigo alerta ameaca crise
polemica critica ataca acusa nega processo investigacao fraude golpe rombo
prejuizo perda calote inadimplencia corte aumento imposto taxacao tributacao
proibicao veto derrota vitoria recorde historico inedito choque surpresa
susto medo panico euforia bolha estouro colapso quebra falencia
""".split())

# As palavras das minhas proprias consultas nao podem virar assunto: se eu
# busco por "inflacao", achar "inflacao" no resultado e tautologia, nao
# descoberta. Derivar isso das consultas mantem a lista correta sozinha
# quando alguem editar CONSULTAS_BR ou CONSULTAS_INT.
def _stopwordsDasConsultas():
    fora = set()
    for _, q in list(CONSULTAS_BR) + list(CONSULTAS_INT):
        limpo = re.sub(r'\b(OR|AND|site|when)\b|[":\d]', ' ', q)
        for palavra in _semAcento(limpo).split():
            if len(palavra) > 3:
                fora.add(palavra)
    for frente, _ in list(CONSULTAS_BR) + list(CONSULTAS_INT):
        fora.add(_semAcento(frente))
    return fora

def _semAcento(txt):
    t = unicodedata.normalize('NFD', txt.lower())
    t = ''.join(c for c in t if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^a-z0-9\s]', ' ', t)

def normalizar(txt):
    t = unicodedata.normalize('NFD', txt.lower())
    t = ''.join(c for c in t if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^a-z0-9\s]', ' ', t)

STOPWORDS |= _stopwordsDasConsultas()

def termos(titulo):
    """Palavras significativas de um titulo, ja normalizadas."""
    return [p for p in normalizar(titulo).split()
            if len(p) > 3 and p not in STOPWORDS and p not in VEICULOS_CONHECIDOS
            and not p.isdigit()]

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
TETO_DISTINTIVO = 0.035  # palavra acima disso e comum demais para carregar assunto

# Verbos e marcadores de manchete. Ao contrario de "assuntos", esta e uma
# classe FECHADA: o jornalismo economico brasileiro usa sempre os mesmos verbos
# de titulo. Um bigrama feito so destas palavras ("atinge maior", "nesta
# feira") descreve a construcao da frase, nao o que aconteceu.
RECHEIO = set("""
atinge atingiu chega chegou passa passou fica ficou segue seguiu volta voltou
sobe subiu cai caiu dispara disparou despenca despencou avanca avancou recua
recuou salta saltou cresce cresceu encolhe encolheu mantem manteve prepara
preparou anuncia anunciou define definiu aprova aprovou rejeita rejeitou
apresenta apresentou defende defendeu afirma afirmou diz disse conta contou
revela revelou aponta apontou indica indicou mostra mostrou registra registrou
acende acendeu amplia ampliou reduz reduziu eleva elevou baixa baixou
comeca comecou termina terminou lanca lancou abre abriu fecha fechou
maior menor melhor pior novo nova novos novas ultimo ultima ultimos ultimas
proximo proxima primeiro primeira segundo segunda terceiro
desde entre sobre contra apos antes durante ainda agora hoje ontem amanha
nesta neste nessa nesse feira semana quinzena periodo
pode podem deve devem vai vao tem tende passam
frente parte forma modo caso ponto nivel meio meta base
holds keeps rises falls jumps drops gains loses adds cuts raises
says said sees expects plans moves seeks eyes weighs
""".split())
IDADE_MAXIMA_H = 60      # materia mais velha que isso nao entra na analise
TETO_FREQUENCIA = 0.14
MIN_MANCHETES = 3

# Uma palavra que encabeca muitos bigramas diferentes ("juros" puxa alta juros,
# corte juros, juros altos...) e categoria, nao assunto. Medido, nao arbitrado.
MAX_BIGRAMAS_POR_CABECA = 3
# O minimo de manchetes para um bigrama contar precisa acompanhar o tamanho do
# corpus. Com limiar fixo, um corpus menor deixava passar palavra generica.

def agrupar(noticias, trends, memoria=None, minimo=MIN_MANCHETES):
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

    # Frequencia de cada palavra no corpus, para medir o que e distintivo.
    freqPalavra = defaultdict(int)
    for n in noticias:
        for t in set(termos(n['titulo'])):
            freqPalavra[t] += 1

    limiarBigrama = max(2, round(total * 0.0015))
    cabecas = defaultdict(set)
    for b, f in freqBigrama.items():
        if f < limiarBigrama:
            continue
        a, c = b.split(' ', 1)
        cabecas[a].add(b)
        cabecas[c].add(b)
    categorias = {w for w, bs in cabecas.items() if len(bs) >= MAX_BIGRAMAS_POR_CABECA}

    # --- passada 2: monta os grupos ----------------------------------------
    # SO BIGRAMAS viram assunto. Palavra solta e sempre uma de duas coisas:
    # categoria ("credito", "inflacao") ou verbo de manchete ("dispara",
    # "alerta", "defende"). Nenhuma das duas e pauta. Tentar filtrar isso com
    # lista de stopwords e jogo perdido - some uma, aparece outra. Exigir duas
    # palavras resolve por construcao: "ibovespa dispara" e assunto,
    # "dispara" sozinho nao e.
    porChave = defaultdict(list)
    for n in noticias:
        bi, _ = chaves(n['titulo'])
        for c in set(bi):
            porChave[c].append(n)

    trendsNorm = {normalizar(t['termo']): t for t in trends}

    grupos = []
    for chave, itens in porChave.items():
        if len(itens) < minimo:
            continue

        freq = len(itens) / total
        if freq > TETO_FREQUENCIA:
            continue

        # Um bigrama de duas palavras comuns ("atinge maior", "nesta feira")
        # e ruido de construcao de manchete, nao assunto. Exigir que ao menos
        # uma das palavras seja distintiva no corpus separa isso de
        # "treasury yields" ou "pesquisa quaest" - e a medida vem do proprio
        # material do dia, sem lista fixa para manter.
        palavras = chave.split()
        if all(p in RECHEIO for p in palavras):
            continue
        raras = [freqPalavra[p] / total for p in palavras]
        if raras and min(raras) > TETO_DISTINTIVO:
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
            'volume': len(itens),
            'veiculos': len(veiculos),
            'listaVeiculos': sorted(veiculos)[:8],
            'frentes': sorted(frentes),
            'recencia': round(recencia, 1),
            'recentes6h': recentes6h,
            'atrito': atrito,
            'trafegoBusca': trafego,
            'raridade': round((1 - freq / TETO_FREQUENCIA) * 100),
            'idadeMediana': round(sorted(
                [i['horas'] for i in itens if i['horas'] is not None] or [0]
            )[len([i for i in itens if i['horas'] is not None]) // 2], 1),
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

        nota = (amplitude * 26 + velocidade * 24 + volume * 14
                + tensao * 14 + busca * 7)
        if len(g['frentes']) > 1:
            nota += 6
        # Novidade e aceleracao entram DEPOIS dos componentes de cobertura.
        # E o que separa "o noticiario continua publicando sobre isso" de
        # "isso mudou hoje" - e o unico jeito de um assunto perene parar de
        # ocupar o topo todo dia.
        nov = classificarNovidade(g['termo'], g['volume'], memoria or [])
        g['novidade'] = nov
        nota += nov['ajuste']

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
        if any(len(titulos & v) >= max(2, len(titulos) * 0.34) for v in vistos):
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

# ---------------------------------------------------------------------------
# MEMORIA ENTRE COLETAS
# ---------------------------------------------------------------------------
# Sem memoria, a ferramenta nao tem como saber que um assunto ja apareceu
# ontem e anteontem. Guardamos o volume de cada assunto por coleta, e isso
# permite responder as duas perguntas que importam para escolher pauta:
# "isso e novo?" e "isso esta acelerando ou so se repetindo?".
ARQUIVO_MEMORIA = os.path.join(RAIZ, 'memoria-coletas.json')
MAX_MEMORIA = 20          # coletas guardadas
MIN_HORAS_ENTRE_REGISTROS = 4   # nao registra recoletas do mesmo periodo

def lerMemoria():
    try:
        with open(ARQUIVO_MEMORIA, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return []

def gravarMemoria(memoria, grupos):
    agora = datetime.now(timezone.utc)
    if memoria:
        try:
            ultima = datetime.fromisoformat(memoria[-1]['em'])
            if (agora - ultima).total_seconds() / 3600 < MIN_HORAS_ENTRE_REGISTROS:
                memoria = memoria[:-1]   # substitui o registro do mesmo periodo
        except Exception:
            pass
    memoria.append({
        'em': agora.isoformat(),
        'termos': {g['termo']: g['volume'] for g in grupos}
    })
    memoria = memoria[-MAX_MEMORIA:]
    try:
        with open(ARQUIVO_MEMORIA, 'w', encoding='utf-8') as f:
            json.dump(memoria, f, ensure_ascii=False)
    except Exception:
        pass
    return memoria

def classificarNovidade(termo, volume, memoria):
    """Compara o assunto com o que ja foi visto. Devolve estado e ajuste.

    Casa por sobreposicao de palavras, nao por texto exato: entre uma coleta e
    outra o mesmo assunto aparece como "treasury yields" ou "bond yields", e
    comparacao literal trataria os dois como novidade.
    """
    partes = set(termo.split())

    aparicoes = []
    for m in memoria:
        melhor = 0
        for t, v in m['termos'].items():
            if partes & set(t.split()):
                melhor = max(melhor, v)
        if melhor:
            aparicoes.append(melhor)

    if not aparicoes:
        return {'estado': 'novo', 'vezes': 0, 'aceleracao': None, 'ajuste': 26}

    anterior = sorted(aparicoes)[len(aparicoes) // 2] or 1
    aceleracao = round(volume / anterior, 2)
    vezes = len(aparicoes)

    if aceleracao >= 1.4:
        return {'estado': 'alta', 'vezes': vezes, 'aceleracao': aceleracao,
                'ajuste': round(min(15 * (aceleracao - 1), 22))}

    # Aqui mora a regua que faltava: assunto que aparece coleta apos coleta sem
    # crescer e pauta velha, por mais que o noticiario continue publicando.
    if vezes >= 3 and aceleracao < 1.15:
        return {'estado': 'recorrente', 'vezes': vezes, 'aceleracao': aceleracao,
                'ajuste': -min(10 + 5 * vezes, 32)}

    return {'estado': 'estavel', 'vezes': vezes, 'aceleracao': aceleracao, 'ajuste': 0}

VALIDADE_CACHE = 300  # segundos

def coletar(forcar=False):
    import time as _t
    if not forcar and _cache['dados'] and (_t.time() - _cache['em']) < VALIDADE_CACHE:
        d = dict(_cache['dados'])
        d['doCache'] = True
        d['idadeCache'] = round(_t.time() - _cache['em'])
        return d

    # (tipo, rotulo, url, idioma)
    tarefas = []
    tarefas += [('news', f, url_news(q, 'pt'), 'pt') for f, q in CONSULTAS_BR]
    tarefas += [('news', f, url_news(q, 'en'), 'en') for f, q in CONSULTAS_INT]
    tarefas += [('site', nome, url_news(q, idi), idi) for nome, q, idi in VIA_GOOGLE_NEWS]
    tarefas += [('feed', nome, url, 'pt') for nome, url in FEEDS_BR]
    tarefas += [('feed', nome, url, 'en') for nome, url in FEEDS_INT]
    tarefas += [('trends', f'Trends {rot}', url, 'pt') for rot, url in TRENDS]

    noticias, trends = [], []
    relatorio = []

    def puxar(t):
        tipo, rot, url, idi = t
        t0 = _t.time()
        try:
            xml = baixar(url)
            return tipo, rot, idi, xml, None, round(_t.time() - t0, 2)
        except Exception as e:
            return tipo, rot, idi, None, f'{type(e).__name__}: {e}'[:180], round(_t.time() - t0, 2)

    with ThreadPoolExecutor(max_workers=18) as pool:
        for tipo, rot, idi, xml, erro, seg in pool.map(puxar, tarefas):
            if erro:
                relatorio.append({'fonte': rot, 'tipo': tipo, 'ok': False, 'itens': 0,
                                  'erro': erro, 'segundos': seg})
                continue
            if tipo == 'trends':
                achados = ler_trends(xml)
                trends += achados
                n = len(achados)
            elif tipo == 'news':
                achados = ler_noticias(xml, rot, idioma=idi)
                noticias += achados
                n = len(achados)
            else:
                # 'site' e 'feed' tem veiculo conhecido
                achados = ler_noticias(xml, 'veiculo' if tipo == 'feed' else rot,
                                       veiculo_fixo=rot, idioma=idi)
                noticias += achados
                n = len(achados)
            relatorio.append({'fonte': rot, 'tipo': tipo, 'ok': True, 'itens': n,
                              'erro': None, 'segundos': seg})

    # Corte duro de idade. Ponderar recencia nao basta: materia velha ainda
    # somava volume e amplitude, e um assunto perene acumulado ao longo de
    # semanas vencia uma noticia de hoje.
    unicas, vistos, velhas = [], set(), 0
    for n in noticias:
        if n['horas'] is not None and n['horas'] > IDADE_MAXIMA_H:
            velhas += 1
            continue
        chave = normalizar(n['titulo'])[:90]
        if chave in vistos:
            continue
        vistos.add(chave)
        unicas.append(n)

    memoria = lerMemoria()
    grupos = agrupar(unicas, trends, memoria)
    gravarMemoria(memoria, grupos)

    oks = [r for r in relatorio if r['ok']]
    resultado = {
        'coletadoEm': datetime.now(timezone.utc).isoformat(),
        'totalManchetes': len(unicas),
        'descartadasPorIdade': velhas,
        'janelaHoras': IDADE_MAXIMA_H,
        'coletasNaMemoria': len(memoria),
        'novos': sum(1 for g in grupos if g['novidade']['estado'] == 'novo'),
        'emAlta': sum(1 for g in grupos if g['novidade']['estado'] == 'alta'),
        'fontesConsultadas': len(tarefas),
        'fontesOk': len(oks),
        'fontesFalhas': len(relatorio) - len(oks),
        'relatorio': sorted(relatorio, key=lambda r: (r['ok'], -r['itens'])),
        'falhas': [f"{r['fonte']}: {r['erro']}" for r in relatorio if not r['ok']],
        'avisoSSL': ('O Python deste computador nao consegue validar certificados, entao a coleta '
                     'esta usando o curl do sistema. Funciona normalmente. Para corrigir a origem: '
                     'abra Applications/Python 3.x e rode "Install Certificates.command".')
                    if _fallback['curl'] else '',
        'modoSSL': 'curl' if _fallback['curl'] else 'padrao',
        'trends': trends[:24],
        'assuntos': grupos,
        'frentes': sorted({n['frente'] for n in unicas}),
        'idiomas': sorted({n.get('idioma', 'pt') for n in unicas}),
        'doCache': False,
    }
    _cache['em'], _cache['dados'] = _t.time(), resultado
    return resultado

# --------------------------------------------------------------------------
# SERVIDOR
# --------------------------------------------------------------------------

# Tipos fixados no codigo, de proposito. O SimpleHTTPRequestHandler pergunta o tipo
# do arquivo para a configuracao da maquina - /etc/apache2/mime.types no Unix e o
# registro do Windows (HKEY_CLASSES_ROOT\.css). Nos dois casos um programa instalado
# pode ter reescrito .css ou .js para text/plain, e no Windows isso e comum. O Chrome
# se recusa a aplicar folha de estilo que nao chegue como text/css: a pagina abre com
# o HTML cru e o navegador nao reclama. Fixar aqui tira a maquina da conta.
TIPOS = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
}


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, **TIPOS}

    def __init__(self, *args, **kwargs):
        # A pasta servida e a do proprio arquivo, nao o diretorio de trabalho.
        # Duplo clique no Windows costuma comecar com o CWD em outro lugar.
        kwargs['directory'] = RAIZ
        super().__init__(*args, **kwargs)

    def end_headers(self):
        # Sem Cache-Control, o Chrome aplica cache heuristico e pode servir o
        # js/app.js do disco por horas SEM perguntar ao servidor - foi assim que
        # uma correcao ja publicada continuou nao aparecendo na tela do usuario.
        # "no-cache" nao proibe guardar: obriga a revalidar a cada carga, o que
        # em localhost custa um 304 e resolve o problema de vez.
        caminho = urlparse(self.path).path
        if caminho.endswith(('.html', '.js', '.css', '.json', '/')) or caminho == '':
            self.send_header('Cache-Control', 'no-cache, must-revalidate')
        super().end_headers()

    def log_message(self, formato, *args):
        # args[0] e a linha da requisicao no log normal, mas um INTEIRO (o codigo)
        # quando vem de log_error. Sem o str(), um simples 404 levantava TypeError
        # aqui dentro e derrubava a thread no meio da resposta - o navegador via a
        # conexao cair em vez de receber o erro.
        alvo = str(args[0]) if args else ''
        if '/api/' in alvo:
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
            return self._json({
                'ok': True, 'servidor': 'Radar Institucional',
                'fontes': (len(CONSULTAS_BR) + len(CONSULTAS_INT) + len(VIA_GOOGLE_NEWS)
                           + len(FEEDS_BR) + len(FEEDS_INT) + len(TRENDS)),
                'consultasBR': len(CONSULTAS_BR), 'consultasINT': len(CONSULTAS_INT),
                'veiculosBR': len(FEEDS_BR), 'veiculosINT': len(FEEDS_INT),
            })
        if caminho == '/api/diagnostico':
            # Testa cada fonte isoladamente e devolve o que aconteceu com cada uma.
            # Existe para quando a coleta volta vazia: sem isso, o usuario so ve
            # "0 manchetes" e nao tem como saber o motivo.
            try:
                d = coletar(forcar=True)
                return self._json({
                    'modoSSL': d['modoSSL'], 'avisoSSL': d['avisoSSL'],
                    'fontesOk': d['fontesOk'], 'fontesFalhas': d['fontesFalhas'],
                    'totalManchetes': d['totalManchetes'],
                    'relatorio': d['relatorio'],
                })
            except Exception as e:
                return self._json({'erro': f'{type(e).__name__}: {e}'}, 500)
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

def autoteste(porta):
    """Pede ao proprio servidor os arquivos do casco e confere o que voltou.

    As duas falhas possiveis aqui sao silenciosas: arquivo faltando depois de uma
    extracao incompleta, e tipo errado no cabecalho. Nos dois casos a pagina abre -
    so que sem estilo nenhum, e o navegador nao reclama. Melhor a ferramenta dizer
    o que houve do que o usuario descobrir na hora de gravar.
    """
    import http.client
    alvos = [('/index.html', 'text/html'), ('/css/app.css', 'text/css'),
             ('/js/app.js', 'javascript'), ('/manifest.json', 'json')]
    problemas = []
    versoes = {}
    for caminho, esperado in alvos:
        try:
            con = http.client.HTTPConnection('127.0.0.1', porta, timeout=5)
            con.request('GET', caminho)
            resp = con.getresponse()
            tipo = resp.getheader('Content-Type') or '(sem tipo)'
            bruto = resp.read()
            corpo = bruto.decode('utf-8', 'ignore')
            tamanho = len(bruto)
            con.close()
            if resp.status != 200:
                problemas.append(f'{caminho}  ->  HTTP {resp.status}: nao esta na pasta')
            elif not tamanho:
                problemas.append(f'{caminho}  ->  chegou vazio')
            elif esperado not in tipo:
                problemas.append(f'{caminho}  ->  servido como "{tipo}", devia ser {esperado}')
            else:
                achado = re.search(r'radar-versao" content="([^"]+)"', corpo) \
                    or re.search(r"VERSAO_APP = '([^']+)'", corpo)
                if achado:
                    versoes[caminho] = achado.group(1)
        except Exception as e:
            problemas.append(f'{caminho}  ->  {type(e).__name__}: {e}')

    # index.html e app.js precisam ser do mesmo pacote. Divergindo, a pasta esta
    # misturada - e a tela vai se comportar de um jeito que nao bate com o codigo.
    if len(set(versoes.values())) > 1:
        problemas.append('versoes diferentes na pasta: '
                         + ', '.join(f'{k} = {v}' for k, v in versoes.items()))
    return problemas


def main():
    argumentos = [a for a in sys.argv[1:] if not a.startswith('-')]
    porta = int(argumentos[0]) if argumentos else PORTA_PADRAO
    try:
        srv = ThreadingHTTPServer(('127.0.0.1', porta), Handler)
    except OSError as e:
        print()
        print(f'  Nao consegui abrir a porta {porta}: {e}')
        print('  Provavelmente ja existe um Radar rodando. Feche a outra janela,')
        print(f'  ou rode em outra porta:   python servidor.py {porta + 1}')
        print()
        return
    print()
    print('  ================================================')
    print('   RADAR INSTITUCIONAL')
    print('  ================================================')
    print()
    print(f'   Aberto em:  http://localhost:{porta}')
    total = (len(CONSULTAS_BR) + len(CONSULTAS_INT) + len(VIA_GOOGLE_NEWS)
             + len(FEEDS_BR) + len(FEEDS_INT) + len(TRENDS))
    print(f'   Coletor:    {total} fontes')
    print(f'               {len(CONSULTAS_BR)} consultas BR + {len(CONSULTAS_INT)} internacionais')
    print(f'               {len(FEEDS_BR)} veiculos BR + {len(FEEDS_INT)} internacionais')
    print(f'               {len(VIA_GOOGLE_NEWS)} via Google News + {len(TRENDS)} Google Trends')
    print()
    print('   NAO FECHE ESTA JANELA enquanto estiver usando.')
    print('   Ctrl+C encerra.')
    print()
    fio = threading.Thread(target=srv.serve_forever, daemon=True)
    fio.start()

    falhas = autoteste(porta)
    if falhas:
        print('   ATENCAO - o casco da aplicacao nao esta sendo servido direito:')
        for f in falhas:
            print(f'     {f}')
        print()
        print('   Se disser "nao esta na pasta", a extracao do zip ficou incompleta:')
        print('   apague a pasta e extraia de novo. Enquanto isso, o arquivo')
        print('   Radar-Institucional-STANDALONE.html abre com duplo clique.')
        print()
    else:
        versao = re.search(r'VERSAO_APP = \'([^\']+)\'',
                           open(os.path.join(RAIZ, 'js', 'app.js'), encoding='utf-8').read())
        print(f"   Casco conferido: HTML, CSS e JS com o tipo certo."
              f"{'  Versao ' + versao.group(1) if versao else ''}")
        print()

    # O navegador so abre depois do autoteste - ou seja, depois que a porta ja
    # respondeu de verdade. Abrir antes disso e o que faz o Chrome mostrar
    # "conexao recusada" e o usuario achar que a ferramenta nao subiu.
    if '--sem-navegador' not in sys.argv:
        try:
            import webbrowser
            webbrowser.open(f'http://localhost:{porta}')
        except Exception:
            pass   # sem navegador padrao: o endereco ja esta impresso acima

    try:
        while fio.is_alive():
            fio.join(0.5)
    except KeyboardInterrupt:
        print('\n  Encerrado.\n')

if __name__ == '__main__':
    main()
