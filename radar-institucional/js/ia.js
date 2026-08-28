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
  constructor(mensagem, status, provedor) {
    super(mensagem);
    this.name = 'ErroIA';
    this.status = status;
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

async function corpoErro(r) {
  try {
    const j = await r.json();
    return (j.error && (j.error.message || j.error.type)) || JSON.stringify(j).slice(0, 200);
  } catch (e) {
    return `HTTP ${r.status}`;
  }
}

function mensagemDeStatus(status, detalhe, provedor, painel) {
  if (status === 401 || status === 403) {
    const dica = provedor === 'Gemini'
      ? ' Dica: a chave precisa ser da Gemini API, criada em aistudio.google.com/apikey com um projeto'
        + ' que tenha a Generative Language API habilitada. Chaves de outros fluxos do Google'
        + ' (Live API, OAuth, Vertex) não servem aqui.'
      : '';
    return `Chave da ${provedor} recusada. (${detalhe})${dica}`;
  }
  if (status === 402) return `Sem créditos na ${provedor}. Adicione saldo em ${painel}.`;
  if (status === 429) return `Limite de uso da ${provedor} atingido. Aguarde alguns instantes.`;
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
      throw new ErroIA(mensagemDeStatus(r.status, await corpoErro(r), 'Anthropic', this.painel),
                       r.status, 'Anthropic');
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
  modelos: [
    { id: 'gemini-3.7-flash', rotulo: 'Gemini 3.7 Flash — rápido e capaz' },
    { id: 'gemini-3.1-pro-preview', rotulo: 'Gemini 3.1 Pro — raciocínio' },
    { id: 'gemini-3.5-flash', rotulo: 'Gemini 3.5 Flash' },
    { id: 'gemini-2.5-flash', rotulo: 'Gemini 2.5 Flash — geração anterior' }
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
      throw new ErroIA(mensagemDeStatus(r.status, await corpoErro(r), 'Gemini', this.painel),
                       r.status, 'Gemini');
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
      throw new ErroIA(mensagemDeStatus(r.status, await corpoErro(r), 'OpenRouter', this.painel),
                       r.status, 'OpenRouter');
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
   Usa o provedor escolhido. Se ele falhar por motivo que trocar de provedor
   resolve (sem credito, limite, instabilidade), tenta os outros configurados.
   Erro de chave invalida nao cai para o proximo do mesmo provedor - trocar de
   modelo nao conserta chave errada.
   ------------------------------------------------------------------------- */
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
    const modelo = modeloEscolhido(cfg, id);

    if (opcoes.aoTentar) {
      opcoes.aoTentar({ provedor: prov.nome, modelo, indice: i, total: fila.length });
    }

    try {
      const mensagens = opcoes.mensagensPara
        ? opcoes.mensagensPara(false)   // busca web paga fica so no OpenRouter
        : opcoes.mensagens;

      const r = await prov.chamar(cfg, mensagens, { ...opcoes, modelo });

      if (!r.texto || !r.texto.trim()) {
        throw new ErroIA(`${prov.nome} devolveu resposta vazia.`, 0, prov.nome);
      }
      return { ...r, provedorUsado: prov.nome, provedorId: id, buscaUsada: false, tentativas };

    } catch (e) {
      if (e.name === 'AbortError') throw e;
      tentativas.push({ provedor: prov.nome, modelo, status: e.status || 0, erro: e.message });
      if (i === fila.length - 1) {
        throw new ErroIA(resumo(tentativas), 0, prov.nome);
      }
    }
  }
  throw new ErroIA(resumo(tentativas), 0, '-');
}

function resumo(tentativas) {
  if (!tentativas.length) return 'Nenhum provedor pôde ser acionado.';
  if (tentativas.length === 1) return tentativas[0].erro;
  return `Tentei ${tentativas.length} provedores e nenhum respondeu:\n`
    + tentativas.map(t => `• ${t.provedor} (${t.modelo}): ${t.erro}`).join('\n');
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
    chamarIA, testarChave, limparChave, ErroIA
  };
}
