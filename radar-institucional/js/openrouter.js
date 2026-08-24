/* =========================================================================
   RADAR INSTITUCIONAL - Cliente OpenRouter
   -------------------------------------------------------------------------
   Endpoint: POST https://openrouter.ai/api/v1/chat/completions
   Busca web: plugins: [{ id: 'web' }] -> devolve annotations com url_citation
   Documentacao: https://openrouter.ai/docs
   ========================================================================= */

const OR_BASE = 'https://openrouter.ai/api/v1';

class ErroOpenRouter extends Error {
  constructor(mensagem, status, corpo) {
    super(mensagem);
    this.name = 'ErroOpenRouter';
    this.status = status;
    this.corpo = corpo;
  }
}

function cabecalhos(apiKey) {
  return {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': location.origin === 'null' ? 'https://radar-institucional.local' : location.origin,
    'X-Title': 'Radar Institucional'
  };
}

/* Diagnostico de falha de rede, com o caso file:// tratado a parte. */
function mensagemDeRede() {
  if (location.protocol === 'file:') {
    return 'Nao consegui falar com a OpenRouter. Voce abriu o arquivo direto do disco '
      + '(file://), e a OpenRouter pode recusar chamadas sem endereco de origem. '
      + 'Rode pelo servidor local: abra o terminal na pasta e execute '
      + '"python3 -m http.server 8080", depois acesse http://localhost:8080. '
      + 'Isso resolve na maioria dos casos.';
  }
  return 'Nao consegui falar com a OpenRouter. Verifique sua conexao com a internet '
    + 'e se algum bloqueador de anuncios ou firewall esta barrando openrouter.ai.';
}

/* Traduz erro de API em mensagem acionavel em portugues. */
function traduzErro(status, corpo) {
  const msg = (corpo && corpo.error && corpo.error.message) || '';
  if (status === 401) return 'Chave da OpenRouter invalida ou ausente. Confira em Configuracoes.';
  if (status === 402) return 'Creditos insuficientes na OpenRouter. Adicione saldo em openrouter.ai/credits.';
  if (status === 429) return 'Limite de requisicoes atingido. Aguarde alguns segundos e tente de novo.';
  if (status === 403) return `Acesso negado pelo modelo escolhido. ${msg}`;
  if (status >= 500) return `Instabilidade na OpenRouter (${status}). Tente novamente.`;
  return msg || `Falha na requisicao (HTTP ${status}).`;
}

/* -------------------------------------------------------------------------
   Chamada principal. Suporta streaming com callback de token.
   ------------------------------------------------------------------------- */
async function chamar(cfg, mensagens, opcoes = {}) {
  if (!cfg.apiKey) {
    throw new ErroOpenRouter('Nenhuma chave da OpenRouter configurada. Abra Configuracoes e cole sua chave.', 0, null);
  }

  const corpo = {
    model: opcoes.modelo || cfg.modelo,
    messages: mensagens,
    temperature: typeof opcoes.temperatura === 'number' ? opcoes.temperatura : cfg.temperatura,
    stream: !!opcoes.aoReceberToken
  };

  if (opcoes.maxTokens) corpo.max_tokens = opcoes.maxTokens;

  // Busca web: e o que torna o resultado verificavel. Ligado por padrao.
  if (opcoes.buscaWeb !== false && cfg.buscaWeb) {
    corpo.plugins = [{
      id: 'web',
      max_results: cfg.maxResultadosBusca || 8,
      search_prompt: 'Resultados de busca atuais. Use apenas fatos que aparecem aqui e sempre registre a URL e a data de cada um:'
    }];
  }

  let resposta;
  try {
    resposta = await fetch(`${OR_BASE}/chat/completions`, {
      method: 'POST',
      headers: cabecalhos(cfg.apiKey),
      body: JSON.stringify(corpo),
      signal: opcoes.signal
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    // Um TypeError aqui quase sempre e a rede caindo antes da resposta.
    // Aberto por file://, a origem vai como "null" e o servidor pode recusar
    // no CORS - o navegador nao deixa a pagina ver o motivo, so o erro generico.
    // Entao o diagnostico tem que vir daqui.
    throw new ErroOpenRouter(mensagemDeRede(), 0, null);
  }

  if (!resposta.ok) {
    let j = null;
    try { j = await resposta.json(); } catch (e) { /* corpo nao-JSON */ }
    throw new ErroOpenRouter(traduzErro(resposta.status, j), resposta.status, j);
  }

  return corpo.stream
    ? await lerStream(resposta, opcoes.aoReceberToken)
    : await lerCompleto(resposta);
}

async function lerCompleto(resposta) {
  const j = await resposta.json();
  const msg = j.choices && j.choices[0] && j.choices[0].message;
  return {
    texto: (msg && msg.content) || '',
    citacoes: extrairCitacoes(msg),
    uso: j.usage || null,
    modelo: j.model || null
  };
}

async function lerStream(resposta, aoReceberToken) {
  const leitor = resposta.body.getReader();
  const dec = new TextDecoder();
  let buffer = '';
  let texto = '';
  let citacoes = [];
  let uso = null;
  let modelo = null;

  while (true) {
    const { done, value } = await leitor.read();
    if (done) break;
    buffer += dec.decode(value, { stream: true });

    const linhas = buffer.split('\n');
    buffer = linhas.pop() || '';

    for (const linha of linhas) {
      const l = linha.trim();
      if (!l || l.startsWith(':')) continue;      // comentario SSE (keep-alive)
      if (!l.startsWith('data:')) continue;
      const dados = l.slice(5).trim();
      if (dados === '[DONE]') continue;

      try {
        const j = JSON.parse(dados);
        if (j.model) modelo = j.model;
        if (j.usage) uso = j.usage;
        const delta = j.choices && j.choices[0] && j.choices[0].delta;
        if (delta && delta.content) {
          texto += delta.content;
          if (aoReceberToken) aoReceberToken(delta.content, texto);
        }
        const m = j.choices && j.choices[0] && j.choices[0].message;
        if (m) {
          const c = extrairCitacoes(m);
          if (c.length) citacoes = c;
        }
        if (delta && delta.annotations) {
          citacoes = citacoes.concat(normalizarAnotacoes(delta.annotations));
        }
      } catch (e) {
        // fragmento SSE incompleto - proxima iteracao completa
      }
    }
  }

  return { texto, citacoes: dedupCitacoes(citacoes), uso, modelo };
}

function extrairCitacoes(msg) {
  if (!msg || !msg.annotations) return [];
  return dedupCitacoes(normalizarAnotacoes(msg.annotations));
}

function normalizarAnotacoes(anotacoes) {
  return (anotacoes || [])
    .filter(a => a && a.type === 'url_citation' && a.url_citation)
    .map(a => ({
      url: a.url_citation.url,
      titulo: a.url_citation.title || a.url_citation.url,
      trecho: a.url_citation.content || ''
    }));
}

function dedupCitacoes(lista) {
  const vistos = new Set();
  return lista.filter(c => {
    if (!c.url || vistos.has(c.url)) return false;
    vistos.add(c.url);
    return true;
  });
}

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

/* Lista de modelos disponiveis (opcional, para o seletor). */
async function listarModelos(cfg) {
  try {
    const r = await fetch(`${OR_BASE}/models`, { headers: cabecalhos(cfg.apiKey) });
    if (!r.ok) return null;
    const j = await r.json();
    return (j.data || [])
      .map(m => ({ id: m.id, rotulo: `${m.name || m.id}`, contexto: m.context_length }))
      .sort((a, b) => a.id.localeCompare(b.id));
  } catch (e) {
    return null;
  }
}

/* Teste rapido de credencial. */
async function testarChave(cfg) {
  try {
    const r = await fetch(`${OR_BASE}/key`, { headers: cabecalhos(cfg.apiKey) });
    if (!r.ok) {
      let j = null;
      try { j = await r.json(); } catch (e) {}
      return { ok: false, mensagem: traduzErro(r.status, j) };
    }
    const j = await r.json();
    const d = j.data || {};
    const limite = d.limit === null || d.limit === undefined ? 'sem limite definido' : `limite ${d.limit}`;
    return { ok: true, mensagem: `Chave valida. Uso: ${d.usage ?? 0} | ${limite}.` };
  } catch (e) {
    return { ok: false, mensagem: mensagemDeRede() };
  }
}

if (typeof window !== 'undefined') {
  window.OR = { chamar, extrairJSON, listarModelos, testarChave, ErroOpenRouter };
}
