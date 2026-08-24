/* =========================================================================
   RADAR INSTITUCIONAL - Configuracao e Persistencia
   ========================================================================= */

const CHAVE_CFG = 'radar_cfg_v1';
const CHAVE_HIST = 'radar_hist_v1';

const CFG_PADRAO = {
  // --- OpenRouter ---
  apiKey: '',
  modelo: 'anthropic/claude-sonnet-4.5',
  modeloRadar: 'anthropic/claude-sonnet-4.5',
  buscaWeb: true,
  maxResultadosBusca: 8,
  temperatura: 0.7,

  // --- Identidade do apresentador ---
  marca: '',
  credenciais: 'CEA e ANCORD',
  formacao: 'Business Intelligence',
  experiencia: 'mais de uma decada no mercado financeiro',
  instituicoes: 'Itau, Santander e corretoras parceiras da XP',
  publico: 'clientes de alta renda',

  // --- Preferencias de producao ---
  formatoPadrao: 'ambos',
  produtoPreferido: '',

  // --- Extras opcionais ---
  brapiToken: ''
};

/* Modelos sugeridos. A lista viva vem da API em /models; estes sao os
   defaults seguros caso a busca falhe. */
const MODELOS_SUGERIDOS = [
  { id: 'anthropic/claude-sonnet-4.5', rotulo: 'Claude Sonnet 4.5 - equilibrio (recomendado)' },
  { id: 'anthropic/claude-opus-4.1',   rotulo: 'Claude Opus 4.1 - maxima qualidade de roteiro' },
  { id: 'openai/gpt-4o',               rotulo: 'GPT-4o - rapido' },
  { id: 'google/gemini-2.5-pro',       rotulo: 'Gemini 2.5 Pro - contexto longo' },
  { id: 'deepseek/deepseek-chat',      rotulo: 'DeepSeek - baixo custo' }
];

function lerCfg() {
  try {
    const bruto = localStorage.getItem(CHAVE_CFG);
    return bruto ? Object.assign({}, CFG_PADRAO, JSON.parse(bruto)) : Object.assign({}, CFG_PADRAO);
  } catch (e) {
    return Object.assign({}, CFG_PADRAO);
  }
}

function salvarCfg(cfg) {
  try {
    localStorage.setItem(CHAVE_CFG, JSON.stringify(cfg));
    return true;
  } catch (e) {
    return false;
  }
}

function lerHistorico() {
  try {
    const bruto = localStorage.getItem(CHAVE_HIST);
    return bruto ? JSON.parse(bruto) : [];
  } catch (e) {
    return [];
  }
}

function salvarNoHistorico(item) {
  try {
    const h = lerHistorico();
    h.unshift(Object.assign({ salvoEm: new Date().toISOString(), id: 'p' + Date.now() }, item));
    localStorage.setItem(CHAVE_HIST, JSON.stringify(h.slice(0, 60)));
    return true;
  } catch (e) {
    return false;
  }
}

function removerDoHistorico(id) {
  try {
    localStorage.setItem(CHAVE_HIST, JSON.stringify(lerHistorico().filter(i => i.id !== id)));
    return true;
  } catch (e) {
    return false;
  }
}

if (typeof window !== 'undefined') {
  window.CFG = {
    CFG_PADRAO, MODELOS_SUGERIDOS,
    lerCfg, salvarCfg, lerHistorico, salvarNoHistorico, removerDoHistorico
  };
}
