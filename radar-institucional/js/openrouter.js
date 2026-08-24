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

/* -------------------------------------------------------------------------
   CATALOGO DE MODELOS
   -------------------------------------------------------------------------
   O endpoint /models e publico: funciona antes mesmo de ter chave. Isso
   permite montar o seletor com a lista viva da OpenRouter em vez de uma
   lista fixa que envelhece.

   A OpenRouter e um roteador. A ideia aqui e a mesma: em vez de cravar um
   modelo, o app pontua o catalogo e escolhe o melhor disponivel no momento,
   priorizando os gratuitos.
   ------------------------------------------------------------------------- */

/* Modelos que existem no catalogo mas nao servem para escrever roteiro:
   geradores de musica, classificadores de seguranca, embeddings, TTS. */
const PADRAO_IMPRESTAVEL = /(lyria|content-safety|guard|moderation|embed|rerank|tts|whisper|transcri|image-gen|video-gen|dall-e|stable-diffusion|flux)/i;

function ehGratuito(m) {
  const p = m.pricing || {};
  return Number(p.prompt) === 0 && Number(p.completion) === 0;
}

function ehRoteador(m) {
  return m.id === 'openrouter/free' || m.id === 'openrouter/auto';
}

/* Extrai o tamanho do modelo do proprio id: "120b-a12b" = 120B totais com
   12B ativos; "9b" = 9B. Pega o maior numero, que e o total. Devolve null
   quando o id nao diz o tamanho - varios nao dizem, e isso nao e demerito. */
function tamanhoEmB(id) {
  const achados = String(id).toLowerCase().match(/(\d+(?:\.\d+)?)b\b/g);
  if (!achados) return null;
  const nums = achados.map((t) => parseFloat(t)).filter((n) => !isNaN(n));
  return nums.length ? Math.max(...nums) : null;
}

/* Pontua a aptidao do modelo para a tarefa: escrever roteiro longo em
   portugues e devolver JSON valido.

   O peso segue a ordem em que as coisas quebram na pratica:
   1. Tamanho do modelo - um modelo pequeno nao sustenta roteiro de 12 minutos
      com coerencia, por mais que cumpra esquema de saida.
   2. Aderencia a esquema - JSON quebrado e a segunda falha mais comum.
   3. Contexto - importa, mas menos que os dois acima. */
function pontuar(m) {
  if (PADRAO_IMPRESTAVEL.test(m.id) || PADRAO_IMPRESTAVEL.test(m.name || '')) return -1;

  // Modelos "stealth" sao experimentais e registram os prompts para avaliacao.
  // Nao entram por padrao numa ferramenta de trabalho.
  if (/^stealth\//i.test(m.id)) return -1;

  const arq = m.architecture || {};
  const entra = arq.input_modalities || [];
  const sai = arq.output_modalities || [];
  if (!entra.includes('text')) return -1;
  if (!sai.includes('text')) return -1;
  if (sai.includes('audio') || sai.includes('image')) return -1;

  const par = m.supported_parameters || [];
  let pt = 0;

  // O roteador gratuito lidera: distribui a carga entre varios modelos e por
  // isso e o que menos esbarra em limite por modelo.
  if (m.id === 'openrouter/free') pt += 1000;

  const b = tamanhoEmB(m.id);
  if (b !== null) {
    if (b < 15) pt -= 400;
    else if (b < 40) pt -= 80;
    else if (b < 90) pt += 80;
    else pt += 200;
  }

  if (par.includes('structured_outputs')) pt += 250;
  if (par.includes('response_format')) pt += 120;

  const ctx = m.context_length || 0;
  if (ctx > 0) pt += Math.log2(ctx) * 12;

  // Texto puro tende a seguir instrucao melhor que multimodal generalista.
  if (entra.length === 1 && entra[0] === 'text') pt += 120;

  return pt;
}

/* Catalogo completo, ja separado e ordenado. */
async function catalogoModelos() {
  const r = await fetch(`${OR_BASE}/models`, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new ErroOpenRouter(`Nao consegui listar os modelos (HTTP ${r.status}).`, r.status, null);
  const j = await r.json();

  const todos = (j.data || []).map((m) => ({
    id: m.id,
    nome: m.name || m.id,
    contexto: m.context_length || 0,
    gratis: ehGratuito(m),
    roteador: ehRoteador(m),
    pontos: pontuar(m)
  }));

  const uteis = todos.filter((m) => m.pontos >= 0);
  const porPontos = (a, b) => b.pontos - a.pontos;

  return {
    roteadores: uteis.filter((m) => m.roteador).sort(porPontos),
    gratuitos: uteis.filter((m) => m.gratis && !m.roteador).sort(porPontos),
    pagos: uteis.filter((m) => !m.gratis && !m.roteador).sort((a, b) => a.id.localeCompare(b.id)),
    total: todos.length,
    atualizadoEm: new Date().toISOString()
  };
}

/* A cadeia que a cascata percorre. Em modo automatico, os melhores
   gratuitos do momento. Em modo manual, o escolhido primeiro e os
   gratuitos logo atras, para nunca ficar sem resposta. */
async function montarCadeia(cfg, modeloPreferido) {
  let cat = null;
  try { cat = await catalogoModelos(); } catch (e) { /* cai no plano B abaixo */ }

  if (!cat) {
    // Sem catalogo, usa o roteador gratuito, que e o id mais estavel que existe.
    return modeloPreferido && modeloPreferido !== 'auto'
      ? [modeloPreferido, 'openrouter/free']
      : ['openrouter/free'];
  }

  const melhoresGratis = [...cat.roteadores.filter((m) => m.gratis), ...cat.gratuitos]
    .map((m) => m.id)
    .slice(0, 6);

  const cadeia = (!modeloPreferido || modeloPreferido === 'auto')
    ? melhoresGratis
    : [modeloPreferido, ...melhoresGratis];

  return [...new Set(cadeia)].slice(0, 7);
}

/* -------------------------------------------------------------------------
   CASCATA - a garantia de que uma varredura sempre devolve alguma coisa
   -------------------------------------------------------------------------
   Percorre a cadeia de modelos ate um responder. Trata dois casos a parte:

   402 (sem creditos): a busca web e cobrada por consulta, mesmo com modelo
   gratuito. Entao 402 com busca ligada quase sempre e a busca, nao o modelo.
   A cascata desliga a busca e repete o MESMO modelo - e avisa quem chamou,
   porque sem busca as regras do roteiro mudam.

   429 (limite): espera e segue para o proximo modelo.
   ------------------------------------------------------------------------- */

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function chamarComCascata(cfg, opcoes = {}) {
  const preferido = opcoes.modelo || cfg.modelo;
  const cadeia = await montarCadeia(cfg, preferido);
  const tentativas = [];

  let comBusca = opcoes.buscaWeb !== false && cfg.buscaWeb;

  for (let i = 0; i < cadeia.length; i++) {
    const modelo = cadeia[i];

    // As mensagens dependem de haver busca ou nao: sem busca, o prompt
    // precisa proibir qualquer fato que nao esteja nos dados injetados.
    const mensagens = opcoes.mensagensPara
      ? opcoes.mensagensPara(comBusca)
      : opcoes.mensagens;

    if (opcoes.aoTentar) opcoes.aoTentar({ modelo, comBusca, indice: i, total: cadeia.length });

    try {
      const r = await chamar(cfg, mensagens, {
        ...opcoes,
        modelo,
        buscaWeb: comBusca
      });

      if (!r.texto || !r.texto.trim()) {
        throw new ErroOpenRouter('O modelo devolveu resposta vazia.', 0, null);
      }

      return { ...r, modeloUsado: modelo, buscaUsada: comBusca, tentativas };

    } catch (e) {
      if (e.name === 'AbortError') throw e;

      tentativas.push({ modelo, comBusca, status: e.status || 0, erro: e.message });

      // Sem creditos e busca ligada: a busca e a causa. Repete sem ela.
      if (e.status === 402 && comBusca) {
        comBusca = false;
        i--;
        continue;
      }

      if (e.status === 429) {
        await espera(1200 * (i + 1));
        continue;
      }

      // 401 e problema de chave: trocar de modelo nao resolve nada.
      if (e.status === 401) throw e;
    }
  }

  throw new ErroOpenRouter(resumirFalhas(tentativas, cadeia), 0, tentativas);
}

function resumirFalhas(tentativas, cadeia) {
  if (!tentativas.length) return 'Nenhum modelo pode ser acionado.';

  const semCredito = tentativas.some((t) => t.status === 402);
  const limitado = tentativas.every((t) => t.status === 429);

  if (limitado) {
    return 'Todos os modelos gratuitos estao no limite de uso agora. '
      + 'O tier gratuito permite 20 chamadas por minuto e 50 por dia. '
      + 'Aguarde alguns minutos e tente de novo.';
  }
  if (semCredito) {
    return 'Sem creditos na OpenRouter e nenhum modelo gratuito respondeu. '
      + 'Adicione saldo em openrouter.ai/credits, ou aguarde: o limite diario '
      + 'do tier gratuito e de 50 chamadas.';
  }

  const ultima = tentativas[tentativas.length - 1];
  return `Tentei ${tentativas.length} modelo(s) de ${cadeia.length} na fila e nenhum respondeu. `
    + `Ultimo erro: ${ultima.erro}`;
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
  window.OR = { chamar, chamarComCascata, extrairJSON, catalogoModelos, montarCadeia, testarChave, ErroOpenRouter };
}
