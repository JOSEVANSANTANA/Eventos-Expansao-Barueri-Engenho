/* =========================================================================
   RADAR INSTITUCIONAL - Catalogo de modelos da OpenRouter
   -------------------------------------------------------------------------
   Este arquivo cuida de UMA coisa: ler o catalogo vivo da OpenRouter e
   ordenar os modelos por aptidao para a tarefa desta ferramenta.

   Quem conversa com as IAs e o js/ia.js. Antes havia aqui um cliente HTTP
   completo - com streaming, tratamento de erro e cascata - que o ia.js
   substituiu ao virar multi-provedor. Manter os dois era ter duas
   implementacoes concorrentes da mesma coisa, e corrigir a errada e o jeito
   mais facil de um bug voltar. O que sobrou aqui e so o catalogo.

   O endpoint /models e publico: funciona antes mesmo de haver chave.
   ========================================================================= */

const OR_BASE = 'https://openrouter.ai/api/v1';

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
  if (!r.ok) throw new Error(`Nao consegui listar os modelos da OpenRouter (HTTP ${r.status}).`);
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

if (typeof window !== 'undefined') {
  window.CATALOGO = { catalogoModelos, pontuar, tamanhoEmB };
}
