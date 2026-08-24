/* =========================================================================
   RADAR INSTITUCIONAL - Teleprompter
   -------------------------------------------------------------------------
   Rolagem continua em subpixel (nao usa scrollBy inteiro, que trava e
   engasga em velocidade baixa). Marcacoes [ASSIM] ficam destacadas em
   ouro para o apresentador ver a direcao sem ler em voz alta.
   ========================================================================= */

const TP = {
  el: null, texto: null,
  rodando: false,
  velocidade: 16,     // pixels por segundo
  posicao: 0,         // acumulador fracionario
  ultimoFrame: 0,
  raf: null,
  roteiros: { short: '', longo: '' },

  iniciar() {
    this.el = document.getElementById('teleprompter');
    this.texto = document.getElementById('tpTexto');

    const vel = document.getElementById('tpVel');
    const tam = document.getElementById('tpTam');

    document.getElementById('tpPlay').onclick = () => this.alternar();
    document.getElementById('tpReiniciar').onclick = () => this.reiniciar();
    document.getElementById('tpFechar').onclick = () => this.fechar();

    vel.oninput = (e) => {
      this.velocidade = +e.target.value;
      document.getElementById('tpVelVal').textContent = e.target.value;
    };

    tam.oninput = (e) => {
      this.el.style.setProperty('--tp-tam', e.target.value + 'px');
      document.getElementById('tpTamVal').textContent = e.target.value;
    };

    document.getElementById('tpEspelho').onchange = (e) => {
      this.el.classList.toggle('espelho', e.target.checked);
    };

    document.getElementById('tpFonte').onchange = (e) => {
      this.carregarTexto(e.target.value);
    };

    document.addEventListener('keydown', (e) => {
      if (!this.el || !this.el.classList.contains('on')) return;
      if (e.code === 'Space') { e.preventDefault(); this.alternar(); }
      else if (e.code === 'Escape') { this.fechar(); }
      else if (e.code === 'ArrowUp') {
        e.preventDefault();
        vel.value = Math.min(60, +vel.value + 2);
        vel.dispatchEvent(new Event('input'));
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        vel.value = Math.max(1, +vel.value - 2);
        vel.dispatchEvent(new Event('input'));
      }
    });

    // Rolagem manual do usuario ressincroniza o acumulador
    this.texto.addEventListener('scroll', () => {
      if (!this.rodando) this.posicao = this.texto.scrollTop;
    });
  },

  definirRoteiros(short, longo) {
    this.roteiros.short = short || '';
    this.roteiros.longo = longo || '';

    const sel = document.getElementById('tpFonte');
    sel.innerHTML = '';
    if (this.roteiros.short) sel.add(new Option('Roteiro Short', 'short'));
    if (this.roteiros.longo) sel.add(new Option('Roteiro Longo', 'longo'));
  },

  carregarTexto(qual) {
    const bruto = this.roteiros[qual] || '';
    this.texto.innerHTML = bruto
      .replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
      .replace(/\[([A-ZÀ-Ú\s]+)\]/g, '<span class="marca">$1</span>')
      .replace(/\n/g, '<br>');
    this.reiniciar();
  },

  abrir(qual) {
    this.el.classList.add('on');
    const sel = document.getElementById('tpFonte');
    const alvo = qual && this.roteiros[qual] ? qual : (sel.value || 'short');
    sel.value = alvo;
    this.carregarTexto(alvo);
  },

  fechar() {
    this.pausar();
    this.el.classList.remove('on');
  },

  alternar() { this.rodando ? this.pausar() : this.tocar(); },

  tocar() {
    this.rodando = true;
    this.ultimoFrame = performance.now();
    this.posicao = this.texto.scrollTop;
    document.getElementById('tpPlay').textContent = '❚❚ Pausar';
    this.animar();
  },

  pausar() {
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

      this.posicao += this.velocidade * dt;
      this.texto.scrollTop = this.posicao;

      const fim = this.texto.scrollHeight - this.texto.clientHeight;
      if (this.posicao >= fim) { this.pausar(); return; }

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
