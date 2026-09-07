/* =========================================================================
   RADAR INSTITUCIONAL - Camada de IA multi-provedor
   -------------------------------------------------------------------------
   Tres provedores, uma interface. Voce escolhe qual usar em cada trabalho.

   Anthropic  api.anthropic.com/v1/messages
              header anthropic-dangerous-direct-browser-access (confirmado
              no preflight CORS: a Anthropic o declara em
              access-control-allow-headers)
   Gemini     generativelanguage.googleapis.com/v1beta/models/{id}
              header x-goog-api-key; responseMimeType forca JSON valido
   OpenRouter openrouter.ai/api/v1/chat/completions

   Chamada HTTP direta, sem SDK: esta e uma pagina de navegador sem etapa de
   build, entao nao ha como empacotar um SDK npm.
   ========================================================================= */

class ErroIA extends Error {
  constructor(mensagem, status, provedor, dados) {
    // dados: o que o provedor mandou junto do erro (espera pedida, tipo de
    // cota, modelo aposentado). A cascata decide com base nisso.

    super(mensagem);
    this.name = 'ErroIA';
    this.status = status;
    this.dados = dados || {};
    this.provedor = provedor;
  }
}

/* ---------- utilidades comuns ------------------------------------------ */

/* Chave colada quase sempre vem com espaco ou quebra de linha invisivel.
   Valor de header HTTP nao aceita esses caracteres: o fetch estoura ANTES de
   sair, com um erro de rede generico que nao diz nada. Por isso todo uso de
   chave passa por aqui. */
function limparChave(v) {
  return String(v || '').replace(/[\s\u200B-\u200D\uFEFF]/g, '');
}

/* Um fetch que nunca vaza erro cru do navegador. Falha aqui e sempre uma de
   tres coisas, e a mensagem diz qual. */
async function buscar(url, opcoes, provedor) {
  try {
    return await fetch(url, opcoes);
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    const detalhe = e && e.message ? ` (${e.message})` : '';
    throw new ErroIA(
      `Não consegui falar com a ${provedor}${detalhe}. Três causas possíveis, nesta ordem: `
      + `1) bloqueador de anúncios ou extensão de privacidade barrando a chamada — `
      + `teste numa janela anônima com as extensões desligadas; `
      + `2) sem internet ou firewall bloqueando o domínio; `
      + `3) a chave contém um caractere inválido — apague o campo e cole de novo.`,
      0, provedor);
  }
}

function origemSegura() {
  return (location.origin && location.origin !== 'null')
    ? location.origin : 'https://radar-institucional.local';
}

/* Le um corpo SSE aplicando um extrator por linha de dados. */
async function lerSSE(resposta, extrair, aoReceberToken) {
  const leitor = resposta.body.getReader();
  const dec = new TextDecoder();
  let buffer = '';
  let texto = '';

  while (true) {
    const { done, value } = await leitor.read();
    if (done) break;
    buffer += dec.decode(value, { stream: true });

    const linhas = buffer.split('\n');
    buffer = linhas.pop() || '';

    for (const linha of linhas) {
      const l = linha.trim();
      if (!l || l.startsWith(':') || l.startsWith('event:')) continue;
      if (!l.startsWith('data:')) continue;
      const dados = l.slice(5).trim();
      if (!dados || dados === '[DONE]') continue;

      try {
        const pedaco = extrair(JSON.parse(dados));
        if (pedaco) {
          texto += pedaco;
          if (aoReceberToken) aoReceberToken(pedaco, texto);
        }
      } catch (e) {
        // fragmento SSE incompleto; a proxima iteracao completa
      }
    }
  }
  return texto;
}

/* O corpo do erro traz mais que uma frase: o Google manda, dentro de
   error.details, um RetryInfo com quanto esperar E qual cota estourou. Antes
   isso era descartado - todo 429 virava "aguarde alguns instantes", e a espera
   era um chute de 2, 4 e 9 segundos que nunca satisfaz uma cota por minuto e
   muito menos a diaria. */
async function corpoErro(r) {
  const vazio = { texto: `HTTP ${r.status}`, espera: 0, diaria: false, modeloMorto: false };
  let j;
  try { j = await r.json(); } catch (e) { return vazio; }

  const texto = (j.error && (j.error.message || j.error.type))
    || JSON.stringify(j).slice(0, 200);
  const detalhes = (j.error && j.error.details) || [];

  // RetryInfo: "retryDelay": "38s"
  let espera = 0;
  detalhes.forEach(d => {
    const m = String(d.retryDelay || '').match(/([\d.]+)s/);
    if (m) espera = Math.ceil(parseFloat(m[1]));
  });

  // QuotaFailure: distingue cota POR DIA de cota por minuto. Numa diaria,
  // insistir hoje nao adianta - a unica saida e outro modelo ou outra chave.
  const tudo = JSON.stringify(detalhes) + ' ' + texto;
  const diaria = /PerDay|per day|daily limit|requests per day/i.test(tudo);

  // Modelo aposentado: o proprio Google diz o substituto na mensagem.
  const modeloMorto = /no longer available|not found|deprecated|has been (retired|removed)/i.test(texto);

  return { texto, espera, diaria, modeloMorto };
}

function mensagemDeStatus(status, erro, provedor, painel) {
  const detalhe = typeof erro === 'string' ? erro : erro.texto;
  const dados = typeof erro === 'string' ? {} : erro;

  if (status === 429) {
    if (dados.diaria) {
      return `Cota DIÁRIA da ${provedor} esgotada neste modelo. Repetir hoje não resolve: `
           + `ela zera na virada do dia (meia-noite no Pacífico, ~4h ou 5h no Brasil). `
           + `Para produzir agora, use outro provedor — uma chave gratuita da OpenRouter `
           + `resolve em dois minutos em openrouter.ai/keys.`;
    }
    return dados.espera
      ? `Limite por minuto da ${provedor} atingido. O próprio Google pediu ${dados.espera}s de espera.`
      : `Limite de uso da ${provedor} atingido. Aguarde alguns instantes.`;
  }

  if (dados.modeloMorto) {
    return `${provedor}: este modelo saiu do ar. ${detalhe}`;
  }

  if (status === 401 || status === 403) {
    const dica = provedor === 'Gemini'
      ? ' Dica: a chave precisa ser da Gemini API, criada em aistudio.google.com/apikey com um projeto'
        + ' que tenha a Generative Language API habilitada. Chaves de outros fluxos do Google'
        + ' (Live API, OAuth, Vertex) não servem aqui.'
      : '';
    return `Chave da ${provedor} recusada. (${detalhe})${dica}`;
  }
  if (status === 402) return `Sem créditos na ${provedor}. Adicione saldo em ${painel}.`;
  if (status >= 500) return `Instabilidade na ${provedor} (${status}). Tente de novo.`;
  return `${provedor}: ${detalhe}`;
}

/* =========================================================================
   ANTHROPIC
   ========================================================================= */
const ANTHROPIC = {
  id: 'anthropic',
  nome: 'Claude (Anthropic)',
  campoChave: 'chaveAnthropic',
  painel: 'console.anthropic.com',
  ondePegar: 'https://console.anthropic.com/settings/keys',
  modelos: [
    { id: 'claude-opus-5', rotulo: 'Claude Opus 5 — melhor roteiro' },
    { id: 'claude-sonnet-5', rotulo: 'Claude Sonnet 5 — equilíbrio' },
    { id: 'claude-haiku-4-5', rotulo: 'Claude Haiku 4.5 — mais barato' }
  ],
  padrao: 'claude-opus-5',

  async chamar(cfg, mensagens, opcoes) {
    const chave = limparChave(cfg.chaveAnthropic);
    if (!chave) throw new ErroIA('Nenhuma chave da Anthropic configurada.', 0, 'Anthropic');

    const modelo = opcoes.modelo || cfg.modeloAnthropic || this.padrao;
    const sistema = mensagens.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
    const conversa = mensagens.filter(m => m.role !== 'system')
      .map(m => ({ role: m.role, content: m.content }));

    const corpo = {
      model: modelo,
      max_tokens: opcoes.maxTokens || 16000,
      messages: conversa,
      stream: true
    };
    if (sistema) corpo.system = sistema;

    const r = await buscar('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': chave,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(corpo),
      signal: opcoes.signal
    }, 'Anthropic');

    if (!r.ok) {
      const detalhes = await corpoErro(r);
      throw new ErroIA(mensagemDeStatus(r.status, detalhes, 'Anthropic', this.painel),
                       r.status, 'Anthropic', detalhes);
    }

    const texto = await lerSSE(r,
      (j) => (j.type === 'content_block_delta' && j.delta && j.delta.type === 'text_delta')
             ? j.delta.text : '',
      opcoes.aoReceberToken);

    return { texto, citacoes: [], modeloUsado: modelo };
  }
};

/* =========================================================================
   GEMINI
   ========================================================================= */
const GEMINI = {
  id: 'gemini',
  nome: 'Gemini (Google)',
  campoChave: 'chaveGemini',
  painel: 'aistudio.google.com',
  ondePegar: 'https://aistudio.google.com/apikey',
  // O gemini-2.5-flash saiu: a propria API responde "no longer available to new
  // users. Please update your code to use models/gemini-3.6-flash". Deixar um
  // modelo morto na lista gasta uma rodada inteira da cascata para nada.
  modelos: [
    { id: 'gemini-3.7-flash', rotulo: 'Gemini 3.7 Flash — rápido e capaz' },
    { id: 'gemini-3.6-flash', rotulo: 'Gemini 3.6 Flash — reserva estável' },
    { id: 'gemini-3.1-pro-preview', rotulo: 'Gemini 3.1 Pro — raciocínio' },
    { id: 'gemini-3.5-flash', rotulo: 'Gemini 3.5 Flash' }
  ],
  padrao: 'gemini-3.7-flash',

  async chamar(cfg, mensagens, opcoes) {
    const chave = limparChave(cfg.chaveGemini);
    if (!chave) throw new ErroIA('Nenhuma chave do Gemini configurada.', 0, 'Gemini');

    const modelo = opcoes.modelo || cfg.modeloGemini || this.padrao;
    const sistema = mensagens.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
    const partes = mensagens.filter(m => m.role !== 'system')
      .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user',
                   parts: [{ text: m.content }] }));

    const corpo = {
      contents: partes,
      generationConfig: {
        temperature: typeof opcoes.temperatura === 'number' ? opcoes.temperatura : cfg.temperatura,
        maxOutputTokens: opcoes.maxTokens || 16000,
        // Forca saida JSON valida: o Gemini respeita isso no nivel do decoder,
        // o que elimina a classe de erro "respondeu fora do formato".
        ...(opcoes.esperaJSON ? { responseMimeType: 'application/json' } : {})
      }
    };
    if (sistema) corpo.systemInstruction = { parts: [{ text: sistema }] };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}`
              + ':streamGenerateContent?alt=sse';

    const r = await buscar(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': chave },
      body: JSON.stringify(corpo),
      signal: opcoes.signal
    }, 'Gemini');

    if (!r.ok) {
      const detalhes = await corpoErro(r);
      throw new ErroIA(mensagemDeStatus(r.status, detalhes, 'Gemini', this.painel),
                       r.status, 'Gemini', detalhes);
    }

    const texto = await lerSSE(r, (j) => {
      const c = j.candidates && j.candidates[0];
      const p = c && c.content && c.content.parts;
      return (p || []).map(x => x.text || '').join('');
    }, opcoes.aoReceberToken);

    return { texto, citacoes: [], modeloUsado: modelo };
  }
};

/* =========================================================================
   OPENROUTER
   ========================================================================= */
const OPENROUTER = {
  id: 'openrouter',
  nome: 'OpenRouter',
  campoChave: 'chaveOpenRouter',
  painel: 'openrouter.ai/credits',
  ondePegar: 'https://openrouter.ai/keys',
  modelos: [
    { id: 'auto', rotulo: 'Automático — melhor gratuito do momento' },
    { id: 'openrouter/free', rotulo: 'Roteador Gratuito' }
  ],
  padrao: 'auto',

  async chamar(cfg, mensagens, opcoes) {
    const chave = limparChave(cfg.chaveOpenRouter);
    if (!chave) throw new ErroIA('Nenhuma chave da OpenRouter configurada.', 0, 'OpenRouter');

    const modelo = opcoes.modelo === 'auto' || !opcoes.modelo
      ? 'openrouter/free' : opcoes.modelo;

    const corpo = {
      model: modelo,
      messages: mensagens,
      temperature: typeof opcoes.temperatura === 'number' ? opcoes.temperatura : cfg.temperatura,
      stream: true
    };
    if (opcoes.maxTokens) corpo.max_tokens = opcoes.maxTokens;
    if (opcoes.buscaWeb) {
      corpo.plugins = [{ id: 'web', max_results: cfg.maxResultadosBusca || 8 }];
    }

    const r = await buscar('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Authorization': `Bearer ${chave}`,
        'HTTP-Referer': origemSegura(),
        'X-Title': 'Radar Institucional'
      },
      body: JSON.stringify(corpo),
      signal: opcoes.signal
    }, 'OpenRouter');

    if (!r.ok) {
      const detalhes = await corpoErro(r);
      throw new ErroIA(mensagemDeStatus(r.status, detalhes, 'OpenRouter', this.painel),
                       r.status, 'OpenRouter', detalhes);
    }

    const citacoes = [];
    const texto = await lerSSE(r, (j) => {
      const d = j.choices && j.choices[0] && j.choices[0].delta;
      if (d && d.annotations) {
        (d.annotations || []).forEach(a => {
          if (a.type === 'url_citation' && a.url_citation) {
            citacoes.push({ url: a.url_citation.url, titulo: a.url_citation.title || a.url_citation.url });
          }
        });
      }
      return (d && d.content) || '';
    }, opcoes.aoReceberToken);

    return { texto, citacoes, modeloUsado: modelo };
  }
};

/* -------------------------------------------------------------------------
   Parse tolerante de JSON. Modelos as vezes envolvem em cerca de codigo
   ou escrevem uma frase antes. Aqui a gente resgata o objeto mesmo assim.
   ------------------------------------------------------------------------- */
function extrairJSON(texto) {
  if (!texto) return null;
  let t = texto.trim();

  // Remove cerca de codigo ```json ... ```
  const cerca = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (cerca) t = cerca[1].trim();

  try { return JSON.parse(t); } catch (e) { /* tenta recorte */ }

  // Recorta do primeiro { ate o ultimo } equilibrado
  const ini = t.indexOf('{');
  const fim = t.lastIndexOf('}');
  if (ini !== -1 && fim > ini) {
    const recorte = t.slice(ini, fim + 1);
    try { return JSON.parse(recorte); } catch (e) { /* segue */ }

    // Ultima tentativa: remove virgulas penduradas antes de } ou ]
    try { return JSON.parse(recorte.replace(/,\s*([}\]])/g, '$1')); } catch (e) { /* desiste */ }
  }
  return null;
}

const PROVEDORES = { anthropic: ANTHROPIC, gemini: GEMINI, openrouter: OPENROUTER };
const ORDEM_PROVEDORES = ['anthropic', 'gemini', 'openrouter'];

/* Quais tem chave preenchida. */
function provedoresProntos(cfg) {
  return ORDEM_PROVEDORES.filter(id => limparChave(cfg[PROVEDORES[id].campoChave]));
}

function modeloEscolhido(cfg, id) {
  const p = PROVEDORES[id];
  return cfg['modelo' + id.charAt(0).toUpperCase() + id.slice(1)] || p.padrao;
}

/* -------------------------------------------------------------------------
   CHAMADA COM RESERVA

   Tres niveis de reserva, do mais barato para o mais caro:

     1. MESMO modelo, de novo, esperando um pouco    <- resolve 503 quase sempre
     2. OUTRO modelo do MESMO provedor
     3. OUTRO provedor configurado

   O nivel 1 existe porque 503 e 429 sao sobrecarga passageira do lado deles:
   o pedido identico costuma passar segundos depois. Antes, uma unica batida de
   503 no Gemini terminava a geracao e sobrava so o botao "Tentar de novo" para
   o usuario clicar na mao - e com uma chave so configurada nao havia nem
   cascata para onde cair.

   O nivel 2 existe porque a sobrecarga costuma ser DAQUELE modelo, nao da conta.
   gemini-3.7-flash lotado nao quer dizer gemini-2.5-flash lotado.

   Chave invalida (401/403) nao repete e nao troca de modelo: nenhuma das duas
   coisas conserta chave errada. Falta de credito (402) nao repete no mesmo
   provedor, mas cai para o proximo, que pode ter saldo.
   ------------------------------------------------------------------------- */

/* Status que valem repetir: sobrecarga, limite e erro interno deles. */
const STATUS_TEMPORARIO = [408, 409, 425, 429, 500, 502, 503, 504];

/* Status em que trocar de MODELO ainda pode resolver dentro do mesmo provedor. */
const STATUS_TROCA_MODELO = [400, 404, 413, 429, 500, 502, 503, 504];

/* Status que nao adianta insistir de jeito nenhum no mesmo provedor. */
const STATUS_SEM_VOLTA = [401, 403, 402];

/* O PRIMEIRO modelo ganha as tres esperas: e o escolhido pelo usuario e o que
   vale insistir. Os modelos alternativos ganham uma so - ali a pergunta e
   "este outro esta de pe?", nao "vai desafogar?". Sem essa distincao, quatro
   modelos x quatro tentativas passavam de 1 minuto olhando para uma tela
   parada antes de desistir. */
const ESPERAS_MS = [1500, 4000, 9000];   // ~15s no modelo principal
const ESPERAS_ALTERNATIVO_MS = [1500];   // ~1,5s em cada modelo de reserva

const dormir = (ms) => new Promise(r => setTimeout(r, ms));

function ehTemporario(e) {
  // Falha de rede chega com status 0: tambem vale repetir, pode ter sido um
  // soluco de conexao e nao um problema real do provedor.
  return STATUS_TEMPORARIO.includes(e.status) || (!e.status && e.name !== 'AbortError');
}

/* Modelos do provedor, com o escolhido na frente e sem repetir. */
function modelosDe(cfg, id) {
  const prov = PROVEDORES[id];
  const escolhido = modeloEscolhido(cfg, id);
  const todos = (prov.modelos || []).map(m => m.id);
  return [escolhido, ...todos].filter((v, i, a) => v && a.indexOf(v) === i);
}

async function chamarIA(cfg, opcoes = {}) {
  const preferido = opcoes.provedor || cfg.provedor;
  const prontos = provedoresProntos(cfg);

  if (!prontos.length) {
    throw new ErroIA('Nenhuma chave configurada. Abra Configurações e preencha ao menos uma: '
      + 'Claude, Gemini ou OpenRouter.', 0, '-');
  }

  const fila = [preferido, ...prontos].filter((v, i, a) => prontos.includes(v) && a.indexOf(v) === i);
  const tentativas = [];

  for (let i = 0; i < fila.length; i++) {
    const id = fila[i];
    const prov = PROVEDORES[id];
    const modelos = modelosDe(cfg, id);
    let pularProvedor = false;

    for (let m = 0; m < modelos.length && !pularProvedor; m++) {
      const modelo = modelos[m];
      const esperas = m === 0 ? ESPERAS_MS : ESPERAS_ALTERNATIVO_MS;

      for (let r = 0; r <= esperas.length; r++) {
        if (opcoes.aoTentar) {
          opcoes.aoTentar({
            provedor: prov.nome, modelo, indice: i, total: fila.length,
            repeticao: r, modeloAlternativo: m > 0
          });
        }

        try {
          const mensagens = opcoes.mensagensPara
            ? opcoes.mensagensPara(false)   // busca web paga fica so no OpenRouter
            : opcoes.mensagens;

          const resposta = await prov.chamar(cfg, mensagens, { ...opcoes, modelo });

          if (!resposta.texto || !resposta.texto.trim()) {
            throw new ErroIA(`${prov.nome} devolveu resposta vazia.`, 0, prov.nome);
          }
          return { ...resposta, provedorUsado: prov.nome, provedorId: id,
                   modeloUsado: modelo, buscaUsada: false, tentativas };

        } catch (e) {
          if (e.name === 'AbortError') throw e;

          tentativas.push({ provedor: prov.nome, modelo, status: e.status || 0,
                            erro: e.message, repeticao: r,
                            diaria: !!(e.dados && e.dados.diaria) });

          if (STATUS_SEM_VOLTA.includes(e.status)) {
            pularProvedor = true;          // chave ou saldo: nem modelo nem espera resolvem
            break;
          }

          // Cota DIARIA estourada: insistir hoje e desperdicio puro. Sai deste
          // modelo na hora e vai para o proximo, que tem cota propria.
          if (e.dados && e.dados.diaria) break;

          // Modelo aposentado: nao existe mais, esperar nao ressuscita.
          if (e.dados && e.dados.modeloMorto) break;

          // Ainda ha espera sobrando e o erro e do tipo que passa sozinho?
          if (r < esperas.length && ehTemporario(e)) {
            // Quando o provedor DIZ quanto esperar, obedecemos: um 429 por
            // minuto pede ate 60s, e o chute de 2s so queima tentativa.
            const pedida = (e.dados && e.dados.espera) ? e.dados.espera * 1000 : 0;
            const espera = Math.min(Math.max(pedida, esperas[r]), 65000);

            if (opcoes.aoEsperar) {
              opcoes.aoEsperar({
                provedor: prov.nome, modelo, status: e.status || 0,
                segundos: Math.round(espera / 1000),
                tentativa: r + 1, de: esperas.length,
                pedidaPeloProvedor: pedida > 0
              });
            }
            await dormir(espera);
            continue;                       // mesmo modelo, mais uma vez
          }

          // Esgotou a espera: outro modelo do mesmo provedor ainda pode servir.
          if (!STATUS_TROCA_MODELO.includes(e.status) && e.status) {
            pularProvedor = true;
          }
          break;
        }
      }
    }
  }

  throw new ErroIA(resumo(tentativas), 0, fila.length ? PROVEDORES[fila[0]].nome : '-');
}

function resumo(tentativas) {
  if (!tentativas.length) return 'Nenhum provedor pôde ser acionado.';
  if (tentativas.length === 1) return tentativas[0].erro;

  // Com repeticao, a mesma falha aparece varias vezes. Listar as 12 linhas
  // esconde a informacao util; o que importa e o ultimo erro de cada modelo e
  // quantas vezes ele bateu.
  const porModelo = new Map();
  tentativas.forEach(t => {
    const chave = `${t.provedor} (${t.modelo})`;
    const atual = porModelo.get(chave) || { vezes: 0, erro: '' };
    porModelo.set(chave, { vezes: atual.vezes + 1, erro: t.erro });
  });

  // Quando a causa e a mesma em todos, o cabecalho ja explicou: repetir o
  // texto inteiro por modelo vira parede de letra e esconde o que importa.
  const mesmaCausa = new Set(tentativas.map(t => t.erro)).size === 1;
  const linhas = Array.from(porModelo.entries()).map(([chave, d]) => {
    const motivo = mesmaCausa ? 'mesma causa' : d.erro;
    return `• ${chave}: ${motivo}${d.vezes > 1 ? ` (${d.vezes} tentativas)` : ''}`;
  });

  const soCota = tentativas.some(t => t.diaria);
  const soSobrecarga = !soCota && tentativas.every(t => STATUS_TEMPORARIO.includes(t.status));

  // Cota estourada nao e "tente de novo": e "use outra porta". A mensagem tem
  // que dizer a saida, senao o usuario fica clicando em Tentar de novo o dia
  // inteiro sem produzir nada - foi exatamente o que aconteceu.
  const cabeca = soCota
    ? `A cota diária da sua chave Gemini acabou — em todos os modelos `
      + `(${porModelo.size} testados). Clicar em "Tentar de novo" não resolve hoje: `
      + `ela zera na virada do dia, meia-noite no Pacífico (~4h ou 5h no Brasil).`
    : soSobrecarga
      ? `Os provedores estão sobrecarregados agora. Tentei ${tentativas.length} vezes em `
        + `${porModelo.size} modelo(s), esperando entre uma e outra, e nenhuma passou. `
        + `Isso costuma durar poucos minutos:`
      : `Tentei ${porModelo.size} combinação(ões) de provedor e modelo:`;

  const saida = soCota
    ? `\n\nPara produzir AGORA, sem esperar a virada do dia:\n`
      + `1. Abra openrouter.ai/keys e crie uma chave (é gratuito e leva dois minutos).\n`
      + `2. Cole em Configurações › OpenRouter e deixe o modelo em "Automático".\n`
      + `A ferramenta passa a usar os modelos gratuitos de lá quando o Gemini fechar.`
    : '';

  return soCota ? `${cabeca}${saida}` : `${cabeca}\n${linhas.join('\n')}${saida}`;
}

/* Teste de chave, por provedor. */
async function testarChave(cfg, id) {
  const prov = PROVEDORES[id];
  const chave = limparChave(cfg[prov.campoChave]);
  if (!chave) return { ok: false, mensagem: 'Campo vazio.' };
  // Sem validacao de formato: o formato das chaves e dos provedores, muda sem
  // aviso, e chutar prefixo so serve para rejeitar chave boa. Quem valida e a API.
  try {
    const r = await prov.chamar({ ...cfg, [prov.campoChave]: chave },
      [{ role: 'user', content: 'Responda apenas: ok' }],
      { maxTokens: 16 });
    return { ok: true, mensagem: `Chave válida — ${prov.nome} respondeu com ${r.modeloUsado}.` };
  } catch (e) {
    return { ok: false, mensagem: e.message };
  }
}

if (typeof window !== 'undefined') {
  window.IA = {
    PROVEDORES, ORDEM_PROVEDORES, provedoresProntos, modeloEscolhido,
    chamarIA, testarChave, limparChave, extrairJSON, ErroIA
  };
}
