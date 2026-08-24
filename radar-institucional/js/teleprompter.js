/* =========================================================================
   RADAR INSTITUCIONAL - Teleprompter
   -------------------------------------------------------------------------
   Dois modos de velocidade:

   AUTOMATICO - calcula a rolagem a partir do proprio roteiro. Conta as
   palavras que serao faladas (ignorando as marcacoes, que nao se le em voz
   alta), soma o tempo das pausas indicadas e divide a altura rolavel por
   esse tempo. Resultado: o texto termina junto com a fala, no ritmo que
   voce escolheu em palavras por minuto.

   MANUAL - pixels por segundo, direto, para quem prefere no olho.
   ========================================================================= */

/* Quanto tempo cada marcacao rouba da fala, em segundos. Marcacao nao e
   lida, mas [PAUSA DRAMATICA] significa que o apresentador para de falar -
   e esse silencio precisa entrar na conta ou o texto sobe rapido demais. */
const PESO_MARCACAO = {
  'PAUSA DRAMATICA': 1.4,
  'PAUSA CURTA': 0.6,
  'BAIXAR O TOM': 0.5,
  'TOM DE CONFISSAO': 0.5,
  'ENFASE NO NUMERO': 0.5,
  'OLHAR DIRETO NA CAMERA': 0.4,
  'APONTAR PARA A TELA': 0.4,
  'GESTO DE CONTAGEM': 0.4,
  'TOM DE ALERTA': 0.3,
  'SORRISO CONFIANTE': 0.3,
  'ACELERAR': 0
};
const PAUSA_PADRAO = 0.3;

/* Faixa de ritmo que um apresentador sustenta em camera, em palavras por
   minuto. Fora disso o problema deixa de ser velocidade e passa a ser o
   tamanho do texto. */
const RITMO_MIN = 100;
const RITMO_MAX = 200;
const RITMO_CONFORTAVEL = 150;

const semAcento = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();

const TP = {
  el: null, texto: null,
  rodando: false,
  modo: 'auto',        // 'auto' | 'manual'
  wpm: 150,            // palavras por minuto faladas (modo automatico)
  velocidadeManual: 16,// pixels por segundo (modo manual)
  posicao: 0,
  ultimoFrame: 0,
  raf: null,
  contagem: null,
  roteiros: { short: '', longo: '' },
  alvos: { short: 0, longo: 0 },   // duracao que o roteiro declara, em segundos
  fonteAtual: '',
  textoAtual: '',

  /* ---------- medicao do roteiro ---------------------------------------- */
  metricas(bruto) {
    const t = bruto || '';
    const marcacoes = t.match(/\[[^\]]*\]/g) || [];

    const falado = t.replace(/\[[^\]]*\]/g, ' ');
    const palavras = (falado.match(/[^\s]+/g) || []).length;

    const pausas = marcacoes.reduce((soma, m) => {
      const chave = semAcento(m.slice(1, -1));
      const peso = PESO_MARCACAO[chave];
      return soma + (peso === undefined ? PAUSA_PADRAO : peso);
    }, 0);

    return { palavras, marcacoes: marcacoes.length, pausas };
  },

  /* Duracao que a leitura deve ter, em segundos. */
  duracaoAlvo() {
    const m = this.metricas(this.textoAtual);
    if (!m.palavras) return 0;
    return (m.palavras / this.wpm) * 60 + m.pausas;
  },

  /* Em que ritmo seria preciso falar para bater a duracao que o roteiro
     declara. Devolve null quando nao ha alvo ou quando as pausas ja
     consomem o tempo inteiro. */
  ritmoParaAlvo() {
    const alvo = this.alvos[this.fonteAtual] || 0;
    if (!alvo) return null;
    const m = this.metricas(this.textoAtual);
    const disponivel = alvo - m.pausas;
    if (!m.palavras || disponivel <= 0) return null;
    return Math.round((m.palavras / disponivel) * 60);
  },

  /* Distancia que a caixa precisa rolar do inicio ao fim. */
  alturaRolavel() {
    if (!this.texto) return 0;
    return Math.max(0, this.texto.scrollHeight - this.texto.clientHeight);
  },

  /* Velocidade efetiva, em pixels por segundo. */
  velocidade() {
    if (this.modo === 'manual') return this.velocidadeManual;
    const dur = this.duracaoAlvo();
    const alt = this.alturaRolavel();
    if (dur <= 0 || alt <= 0) return this.velocidadeManual;
    return alt / dur;
  },

  /* ---------- ciclo de vida --------------------------------------------- */
  iniciar() {
    this.el = document.getElementById('teleprompter');
    this.texto = document.getElementById('tpTexto');

    const $ = (id) => document.getElementById(id);

    $('tpPlay').onclick = () => this.alternar();
    $('tpReiniciar').onclick = () => this.reiniciar();
    $('tpFechar').onclick = () => this.fechar();

    $('tpModo').onchange = (e) => {
      this.modo = e.target.value;
      this.el.classList.toggle('manual', this.modo === 'manual');
      this.atualizarPainel();
    };

    $('tpWpm').oninput = (e) => {
      this.wpm = +e.target.value;
      this.atualizarPainel();
    };

    $('tpVel').oninput = (e) => {
      this.velocidadeManual = +e.target.value;
      this.atualizarPainel();
    };

    $('tpTam').oninput = (e) => {
      this.el.style.setProperty('--tp-tam', e.target.value + 'px');
      $('tpTamVal').textContent = e.target.value;
      // Fonte maior estica o texto: a altura rolavel muda e, no modo
      // automatico, a velocidade tem que ser recalculada junto.
      requestAnimationFrame(() => { this.ajustarEspacos(); this.atualizarPainel(); });
    };

    $('tpEspelho').onchange = (e) => this.el.classList.toggle('espelho', e.target.checked);

    $('tpFonte').onchange = (e) => this.carregarTexto(e.target.value);

    document.addEventListener('keydown', (e) => {
      if (!this.el || !this.el.classList.contains('on')) return;
      if (e.code === 'Space') { e.preventDefault(); this.alternar(); }
      else if (e.code === 'Escape') { this.fechar(); }
      else if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        e.preventDefault();
        const passo = e.code === 'ArrowUp' ? 1 : -1;
        if (this.modo === 'auto') {
          const el = $('tpWpm');
          el.value = Math.min(220, Math.max(80, +el.value + passo * 5));
          el.dispatchEvent(new Event('input'));
        } else {
          const el = $('tpVel');
          el.value = Math.min(120, Math.max(1, +el.value + passo * 2));
          el.dispatchEvent(new Event('input'));
        }
      }
    });

    // Rolagem manual do usuario ressincroniza o acumulador.
    this.texto.addEventListener('scroll', () => {
      if (!this.rodando) this.posicao = this.texto.scrollTop;
    });

    // Girar o celular ou redimensionar muda a altura rolavel.
    window.addEventListener('resize', () => {
      if (this.el.classList.contains('on')) { this.ajustarEspacos(); this.atualizarPainel(); }
    });
  },

  definirRoteiros(short, longo, alvos) {
    this.roteiros.short = short || '';
    this.roteiros.longo = longo || '';
    this.alvos.short = (alvos && alvos.short) || 0;
    this.alvos.longo = (alvos && alvos.longo) || 0;

    const sel = document.getElementById('tpFonte');
    sel.innerHTML = '';
    if (this.roteiros.short) sel.add(new Option('Roteiro Short', 'short'));
    if (this.roteiros.longo) sel.add(new Option('Roteiro Longo', 'longo'));
    if (!sel.options.length) sel.add(new Option('Nenhum roteiro carregado', ''));
  },

  carregarTexto(qual) {
    const bruto = this.roteiros[qual] || '';
    this.textoAtual = bruto;
    this.fonteAtual = qual;

    const corpo = bruto
      .replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
      .replace(/\[([^\]]*)\]/g, '<span class="marca">$1</span>')
      .replace(/\n/g, '<br>');

    // Os espacadores sao o que permite a primeira e a ultima linha chegarem
    // a altura da linha-guia. Antes isso era padding vertical, que criava um
    // piso de altura e empurrava a barra de controles para fora da tela.
    this.texto.innerHTML =
      '<div class="tp-espaco" data-esp="topo"></div>'
      + `<div class="tp-conteudo">${corpo}</div>`
      + '<div class="tp-espaco" data-esp="base"></div>';

    this.reiniciar();
    requestAnimationFrame(() => { this.ajustarEspacos(); this.atualizarPainel(); });
  },

  /* Dimensiona os espacadores contra a altura real da caixa de texto.
     A guia visual fica em 42% da tela, entao o espaco de cima e 42% e o de
     baixo 58% - assim a primeira e a ultima linha param exatamente nela. */
  ajustarEspacos() {
    if (!this.texto) return;
    const h = this.texto.clientHeight;
    const topo = this.texto.querySelector('[data-esp="topo"]');
    const base = this.texto.querySelector('[data-esp="base"]');
    if (topo) topo.style.height = Math.round(h * 0.42) + 'px';
    if (base) base.style.height = Math.round(h * 0.58) + 'px';
  },

  abrir(qual) {
    this.el.classList.add('on');
    const sel = document.getElementById('tpFonte');
    const disponivel = [...sel.options].map((o) => o.value).filter(Boolean);
    const alvo = (qual && this.roteiros[qual]) ? qual : (disponivel[0] || '');
    if (alvo) sel.value = alvo;
    this.carregarTexto(alvo);
  },

  fechar() {
    this.pausar();
    this.cancelarContagem();
    this.el.classList.remove('on');
  },

  /* ---------- painel de leitura ----------------------------------------- */
  atualizarPainel() {
    const m = this.metricas(this.textoAtual);
    const vel = this.velocidade();
    const alt = this.alturaRolavel();
    const dur = this.modo === 'auto'
      ? this.duracaoAlvo()
      : (vel > 0 ? alt / vel : 0);

    const fmt = (s) => {
      if (!s || !isFinite(s)) return '—';
      const min = Math.floor(s / 60);
      const seg = Math.round(s % 60);
      return min ? `${min}min ${String(seg).padStart(2, '0')}s` : `${seg}s`;
    };

    const painel = document.getElementById('tpPainel');
    if (painel) {
      if (!m.palavras) {
        painel.innerHTML = 'Nenhum roteiro carregado. Gere um pacote no Radar do Dia.';
      } else {
        let txt = `<b>${m.palavras}</b> palavras · <b>${m.marcacoes}</b> marcações `
                + `(+${m.pausas.toFixed(1)}s de pausa) · leitura <b>${fmt(dur)}</b>`;

        // O roteiro foi escrito para uma duracao. Se o ritmo atual nao bate,
        // diz em quantas palavras por minuto bateria - e melhor descobrir
        // isso aqui do que na terceira regravacao.
        const alvo = this.alvos[this.fonteAtual] || 0;
        const ppmAlvo = this.ritmoParaAlvo();
        if (alvo && ppmAlvo && this.modo === 'auto') {
          const folga = dur - alvo;

          if (Math.abs(folga) <= Math.max(3, alvo * 0.06)) {
            txt += ` · <span class="tp-ok">no alvo de ${fmt(alvo)}</span>`;

          } else if (ppmAlvo >= RITMO_MIN && ppmAlvo <= RITMO_MAX) {
            // Da para chegar la so mudando o ritmo de fala.
            txt += ` · <span class="tp-fora">roteiro pede ${fmt(alvo)}`
                 + ` — ${folga > 0 ? `${Math.round(folga)}s a mais` : `${Math.round(-folga)}s a menos`};`
                 + ` use ${ppmAlvo} ppm</span>`;

          } else {
            // Ritmo humano nao cobre a diferenca: o problema e o tamanho do
            // texto, nao a velocidade. Diz quantas palavras faltam ou sobram,
            // que e a informacao acionavel de verdade.
            const util = Math.max(1, alvo - m.pausas);
            const ideal = Math.round((util / 60) * RITMO_CONFORTAVEL);
            const dif = m.palavras - ideal;
            txt += ` · <span class="tp-fora">roteiro pede ${fmt(alvo)}: `
                 + (dif > 0
                    ? `corte ~${dif} palavras`
                    : `faltam ~${Math.abs(dif)} palavras`)
                 + ` (não dá para resolver só com a velocidade)</span>`;
          }
        }
        painel.innerHTML = txt;
      }
    }

    const vv = document.getElementById('tpVelVal');
    if (vv) vv.textContent = this.modo === 'auto'
      ? `${this.wpm} ppm`
      : `${this.velocidadeManual} px/s`;

    const efetiva = document.getElementById('tpEfetiva');
    if (efetiva) efetiva.textContent = vel > 0 ? `${vel.toFixed(1)} px/s` : '—';

    const wv = document.getElementById('tpWpmVal');
    if (wv) wv.textContent = this.wpm;
  },

  /* ---------- transporte ------------------------------------------------ */
  alternar() { this.rodando || this.contagem ? this.pausar() : this.iniciarContagem(); },

  /* Contagem regressiva antes de rolar: da tempo de olhar para a lente. */
  iniciarContagem() {
    if (!this.textoAtual) return;
    this.cancelarContagem();

    const aviso = document.getElementById('tpContagem');
    let n = 3;
    const mostrar = () => {
      if (aviso) { aviso.textContent = n; aviso.classList.add('on'); }
    };
    mostrar();
    document.getElementById('tpPlay').textContent = '❚❚ Cancelar';

    this.contagem = setInterval(() => {
      n -= 1;
      if (n > 0) { mostrar(); return; }
      this.cancelarContagem();
      this.tocar();
    }, 800);
  },

  cancelarContagem() {
    if (this.contagem) { clearInterval(this.contagem); this.contagem = null; }
    const aviso = document.getElementById('tpContagem');
    if (aviso) aviso.classList.remove('on');
  },

  tocar() {
    this.rodando = true;
    this.ultimoFrame = performance.now();
    this.posicao = this.texto.scrollTop;
    document.getElementById('tpPlay').textContent = '❚❚ Pausar';
    this.animar();
  },

  pausar() {
    this.cancelarContagem();
    this.rodando = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    const b = document.getElementById('tpPlay');
    if (b) b.textContent = '▶ Iniciar';
  },

  animar() {
    if (!this.rodando) return;
    this.raf = requestAnimationFrame((agora) => {
      const dt = (agora - this.ultimoFrame) / 1000;
      this.ultimoFrame = agora;

      // Acumulador fracionario: scrollTop e inteiro, entao somar direto
      // engasgaria em velocidade baixa.
      this.posicao += this.velocidade() * dt;
      this.texto.scrollTop = this.posicao;

      if (this.posicao >= this.alturaRolavel()) { this.pausar(); return; }
      this.animar();
    });
  },

  reiniciar() {
    this.pausar();
    this.posicao = 0;
    if (this.texto) this.texto.scrollTop = 0;
  }
};

if (typeof window !== 'undefined') window.TP = TP;
