/* =========================================================================
   RADAR INSTITUCIONAL - Camada de Dados Reais
   -------------------------------------------------------------------------
   Fontes primarias, todas publicas e com CORS liberado para o navegador:
     - Banco Central / SGS      https://api.bcb.gov.br/dados/serie/...
     - Banco Central / Focus    https://olinda.bcb.gov.br/olinda/servico/Expectativas
     - IBGE / SIDRA             https://servicodados.ibge.gov.br/api/v3/agregados
   Nenhum numero deste arquivo e digitado a mao. Tudo vem da API, com data.
   ========================================================================= */

const SGS = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs';
const FOCUS = 'https://olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata/ExpectativasMercadoAnuais';

/* Series validadas manualmente contra o portal do BCB.
   linkFonte permite ao usuario auditar qualquer numero em um clique. */
const SERIES = [
  { cod: 432,   chave: 'selic',     rotulo: 'Selic (meta Copom)',        unidade: '% a.a.', tipo: 'diaria' },
  { cod: 4389,  chave: 'cdi',       rotulo: 'CDI',                       unidade: '% a.a.', tipo: 'diaria' },
  { cod: 13522, chave: 'ipca12m',   rotulo: 'IPCA acumulado 12 meses',   unidade: '%',      tipo: 'mensal' },
  { cod: 433,   chave: 'ipcaMes',   rotulo: 'IPCA no mes',               unidade: '%',      tipo: 'mensal' },
  { cod: 1,     chave: 'dolar',     rotulo: 'Dolar PTAX (venda)',        unidade: 'R$',     tipo: 'diaria' },
  { cod: 21619, chave: 'euro',      rotulo: 'Euro PTAX (venda)',         unidade: 'R$',     tipo: 'diaria' },
  { cod: 189,   chave: 'igpm',      rotulo: 'IGP-M no mes',              unidade: '%',      tipo: 'mensal' },
  { cod: 195,   chave: 'poupanca',  rotulo: 'Poupanca (rendimento)',     unidade: '%',      tipo: 'periodo' }
];

const linkSerie = (cod) =>
  `https://www3.bcb.gov.br/sgspub/consultarvalores/consultarValoresSeries.do?method=consultarValores&optSelecionaSerie=${cod}`;

async function buscarJSON(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

/* ---- Series do SGS -------------------------------------------------- */
async function buscarSerie(s) {
  const dados = await buscarJSON(`${SGS}.${s.cod}/dados/ultimos/1?formato=json`);
  const ultimo = Array.isArray(dados) ? dados[dados.length - 1] : null;
  if (!ultimo) throw new Error('serie vazia');
  return {
    chave: s.chave,
    rotulo: s.rotulo,
    unidade: s.unidade,
    valor: parseFloat(ultimo.valor),
    valorBruto: ultimo.valor,
    data: ultimo.data,
    codigo: s.cod,
    fonte: 'Banco Central do Brasil - SGS',
    linkFonte: linkSerie(s.cod),
    ok: true
  };
}

/* ---- Focus: expectativa de mercado ---------------------------------- */
async function buscarFocus(indicador, ano) {
  const filtro = encodeURIComponent(`Indicador eq '${indicador}' and DataReferencia eq '${ano}' and baseCalculo eq 0`);
  const url = `${FOCUS}?$top=1&$filter=${filtro}&$orderby=Data desc&$format=json`;
  const j = await buscarJSON(url);
  const v = j && j.value && j.value[0];
  if (!v) throw new Error('focus vazio');
  return {
    indicador,
    ano,
    mediana: v.Mediana,
    media: v.Media,
    minimo: v.Minimo,
    maximo: v.Maximo,
    respondentes: v.numeroRespondentes,
    data: v.Data,
    fonte: 'Banco Central - Relatorio Focus',
    linkFonte: 'https://www.bcb.gov.br/publicacoes/focus',
    ok: true
  };
}

/* ---- Coleta completa ------------------------------------------------- */
async function coletarPanorama() {
  const anoAtual = new Date().getFullYear();

  const resultados = await Promise.allSettled([
    ...SERIES.map(buscarSerie),
    buscarFocus('Selic', anoAtual),
    buscarFocus('IPCA', anoAtual),
    buscarFocus('PIB Total', anoAtual),
    buscarFocus('Câmbio', anoAtual)
  ]);

  const indicadores = {};
  const expectativas = {};
  const falhas = [];

  resultados.forEach((r) => {
    if (r.status === 'fulfilled') {
      const v = r.value;
      if (v.chave) indicadores[v.chave] = v;
      else expectativas[v.indicador] = v;
    } else {
      falhas.push(String(r.reason && r.reason.message ? r.reason.message : r.reason));
    }
  });

  return {
    indicadores,
    expectativas,
    falhas,
    coletadoEm: new Date().toISOString(),
    // Juro real ex-ante aproximado: (1+selic)/(1+ipca esperado) - 1
    juroReal: calcularJuroReal(indicadores.selic, expectativas.IPCA)
  };
}

function calcularJuroReal(selic, ipcaEsperado) {
  if (!selic || !ipcaEsperado || typeof ipcaEsperado.mediana !== 'number') return null;
  const jr = ((1 + selic.valor / 100) / (1 + ipcaEsperado.mediana / 100) - 1) * 100;
  return {
    valor: Number(jr.toFixed(2)),
    metodo: 'Juro real ex-ante = (1 + Selic meta) / (1 + IPCA esperado Focus) - 1',
    componentes: `Selic ${selic.valor}% a.a. (${selic.data}) / IPCA esperado ${ipcaEsperado.mediana}% (Focus ${ipcaEsperado.data})`
  };
}

/* ---- Formatacao para o bloco de "verdade de base" enviado a IA -------- */
function panoramaParaTexto(p) {
  if (!p) return 'Sem dados coletados.';
  const linhas = ['DADOS MACRO REAIS (fonte primaria, coletados agora):'];

  Object.values(p.indicadores).forEach((i) => {
    const valorFmt = i.unidade === 'R$' ? `R$ ${i.valor.toFixed(4)}` : `${i.valor}${i.unidade}`;
    linhas.push(`- ${i.rotulo}: ${valorFmt} (data do dado: ${i.data} | Fonte: ${i.fonte}, serie ${i.codigo})`);
  });

  Object.values(p.expectativas).forEach((e) => {
    linhas.push(`- Expectativa de mercado ${e.indicador} ${e.ano} (mediana Focus): ${e.mediana} | ${e.respondentes} respondentes | coleta ${e.data} | Fonte: ${e.fonte}`);
  });

  if (p.juroReal) {
    linhas.push(`- Juro real ex-ante estimado: ${p.juroReal.valor}% a.a. (${p.juroReal.metodo}; ${p.juroReal.componentes})`);
  }

  if (p.falhas.length) {
    linhas.push(`\nATENCAO: ${p.falhas.length} indicador(es) nao puderam ser coletados nesta sessao. NAO invente valor para eles - omita ou marque como nao verificado.`);
  }

  return linhas.join('\n');
}

/* ---- Fontes externas de tendencia (deep links pre-preenchidos) --------
   Estas plataformas nao expoem API publica gratuita compativel com
   navegador. Em vez de fingir integracao, a ferramenta abre a consulta
   certa em um clique e aceita colagem do resultado.                      */
const FONTES_TENDENCIA = [
  { nome: 'Google Trends BR (agora)',  url: 'https://trends.google.com.br/trending?geo=BR&hours=24', tipo: 'Tendencia em tempo real', gratis: true },
  { nome: 'Google Trends - explorar',  url: 'https://trends.google.com.br/trends/explore?date=now%207-d&geo=BR&q=investimentos,selic,d%C3%B3lar,imposto%20de%20renda', tipo: 'Comparativo de termos', gratis: true },
  { nome: 'Google News - Economia BR', url: 'https://news.google.com/search?q=mercado%20financeiro%20quando%3A2d&hl=pt-BR&gl=BR&ceid=BR%3Apt-419', tipo: 'Noticia quente', gratis: true },
  { nome: 'Exploding Topics - Finance',url: 'https://explodingtopics.com/finance', tipo: 'Tema emergente', gratis: 'parcial' },
  { nome: 'Glimpse',                   url: 'https://meetglimpse.com/', tipo: 'Tendencia emergente', gratis: 'parcial' },
  { nome: 'AnswerThePublic',           url: 'https://answerthepublic.com/', tipo: 'Perguntas do publico', gratis: 'parcial' },
  { nome: 'Pinterest Trends BR',       url: 'https://trends.pinterest.com/?country=BR', tipo: 'Tendencia visual', gratis: true },
  { nome: 'BuzzSumo',                  url: 'https://buzzsumo.com/', tipo: 'Conteudo mais compartilhado', gratis: false },
  { nome: 'Semrush',                   url: 'https://www.semrush.com/', tipo: 'Volume de busca / SEO', gratis: false },
  { nome: 'Ahrefs',                    url: 'https://ahrefs.com/', tipo: 'Backlink / keyword', gratis: false },
  { nome: 'B3 - Noticias',             url: 'https://www.b3.com.br/pt_br/noticias/', tipo: 'Fonte oficial', gratis: true },
  { nome: 'BCB - Notas e comunicados', url: 'https://www.bcb.gov.br/detalhenoticia', tipo: 'Fonte oficial', gratis: true },
  { nome: 'IBGE - Releases',           url: 'https://agenciadenoticias.ibge.gov.br/agencia-sala-de-imprensa.html', tipo: 'Fonte oficial', gratis: true },
  { nome: 'CVM - Noticias',            url: 'https://www.gov.br/cvm/pt-br/assuntos/noticias', tipo: 'Regulatorio', gratis: true }
];

if (typeof window !== 'undefined') {
  window.DADOS = {
    SERIES, FONTES_TENDENCIA,
    coletarPanorama, panoramaParaTexto, buscarSerie, buscarFocus, linkSerie
  };
}
