/* =========================================================================
   RADAR INSTITUCIONAL - Configuracao e Persistencia
   ========================================================================= */

const CHAVE_CFG = 'radar_cfg_v1';
const CHAVE_HIST = 'radar_hist_v1';

const CFG_PADRAO = {
  // --- OpenRouter ---
  apiKey: '',
  // 'auto' = o app pontua o catalogo vivo da OpenRouter e escolhe o melhor
  // gratuito do momento, com cascata de reserva atras.
  modelo: 'auto',
  modeloRadar: 'auto',
  // Desligada por padrao. A busca da OpenRouter faz busca semantica e devolve
  // perfil de LinkedIn e pagina institucional no lugar de noticia. Quem traz
  // noticia aqui e o coletor local, que le feed de veiculo de verdade.
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

  // --- Extras opcionais ---
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
    CFG_PADRAO, MODELOS_RESERVA,
    lerCfg, salvarCfg, lerHistorico, salvarNoHistorico, removerDoHistorico
  };
}
