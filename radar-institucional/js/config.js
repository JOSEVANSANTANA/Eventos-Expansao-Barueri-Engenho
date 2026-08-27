/* =========================================================================
   RADAR INSTITUCIONAL - Configuracao e Persistencia
   ========================================================================= */

const CHAVE_CFG = 'radar_cfg_v1';
const CHAVE_HIST = 'radar_hist_v1';

const CFG_PADRAO = {
  // --- Chaves, uma por provedor. Todas opcionais; basta uma. ---
  chaveAnthropic: '',
  chaveGemini: '',
  chaveOpenRouter: '',

  // Provedor preferido. A tela de escolha aparece na hora de rodar quando
  // ha mais de uma chave configurada.
  provedor: 'anthropic',
  perguntarProvedor: true,

  // Modelo por provedor
  modeloAnthropic: 'claude-opus-5',
  modeloGemini: 'gemini-3.7-flash',
  modeloOpenrouter: 'auto',

  // --- Busca web paga (so OpenRouter). Desligada: devolve perfil de
  //     LinkedIn e pagina institucional em vez de noticia. ---
  buscaWeb: false,
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

  brapiToken: ''
};

/* Plano B do seletor: usado apenas se o catalogo da OpenRouter nao carregar.
   Sao ids de roteador, que mudam menos que ids de modelo especifico. */
const MODELOS_RESERVA = [
  { id: 'auto', rotulo: 'Automatico - melhor gratuito do momento (recomendado)' },
  { id: 'openrouter/free', rotulo: 'Roteador Gratuito da OpenRouter' },
  { id: 'openrouter/auto', rotulo: 'Roteador Automatico (pago, escolhe o melhor)' }
];

function lerCfg() {
  try {
    const bruto = localStorage.getItem(CHAVE_CFG);
    const salvo = bruto ? JSON.parse(bruto) : {};
    // Versoes anteriores guardavam uma chave so, em "apiKey". Preserva.
    if (salvo.apiKey && !salvo.chaveOpenRouter) salvo.chaveOpenRouter = salvo.apiKey;
    return Object.assign({}, CFG_PADRAO, salvo);
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
    CFG_PADRAO, MODELOS_RESERVA,
    lerCfg, salvarCfg, lerHistorico, salvarNoHistorico, removerDoHistorico
  };
}
