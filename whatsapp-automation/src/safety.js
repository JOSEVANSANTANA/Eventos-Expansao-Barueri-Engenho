'use strict';

const { DAY_MS } = require('./ledger');

/**
 * Politica anti-bloqueio.
 *
 * O classificador do WhatsApp reage a um conjunto de sinais: volume por janela
 * de tempo, cadencia regular demais, texto identico repetido, mensagens fora de
 * horario e, com peso muito maior, bloqueios e denuncias de quem recebeu.
 * Esta classe governa os sinais que dependem de nos.
 */

const DEFAULTS = {
  minDelay: 45000,        // 45s
  maxDelay: 120000,       // 2min
  dailyLimit: 80,
  hourlyLimit: 20,
  batchSize: 15,          // envios antes de uma pausa longa
  batchPauseMin: 900000,  // 15min
  batchPauseMax: 1800000, // 30min
  windowStart: 9,         // hora local
  windowEnd: 20,
  respectWindow: true,
  cooldownDays: 7,        // nao repetir a mesma pessoa antes disso
  warmup: true,
  maxConsecutiveFailures: 5,
};

/** Curva de aquecimento: comeca baixo e sobe ao longo de duas semanas. */
function warmupLimit(daysActive) {
  const curve = [20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 140, 160, 180];
  return daysActive >= curve.length ? Infinity : curve[daysActive];
}

class SafetyPolicy {
  constructor(config = {}, { ledger, logger }) {
    this.config = { ...DEFAULTS, ...sanitize(config) };
    this.ledger = ledger;
    this.logger = logger;
    this.sentInRun = 0;
    this.consecutiveFailures = 0;
  }

  /** Limite diario efetivo, considerando o aquecimento. */
  effectiveDailyLimit() {
    const configured = this.config.dailyLimit;
    if (!this.config.warmup) return configured;
    return Math.min(configured, warmupLimit(this.ledger.daysActive()));
  }

  insideWindow(date = new Date()) {
    if (!this.config.respectWindow) return true;
    const hour = date.getHours();
    const { windowStart, windowEnd } = this.config;
    return windowStart <= windowEnd
      ? hour >= windowStart && hour < windowEnd
      : hour >= windowStart || hour < windowEnd; // janela que cruza a meia-noite
  }

  /** Milissegundos ate a proxima abertura da janela de envio. */
  msUntilWindow(date = new Date()) {
    if (this.insideWindow(date)) return 0;
    const next = new Date(date);
    next.setMinutes(0, 0, 0);
    next.setHours(this.config.windowStart);
    if (next <= date) next.setDate(next.getDate() + 1);
    return next.getTime() - date.getTime();
  }

  /**
   * Decide se um destinatario pode receber agora.
   * @returns {{ allowed: boolean, reason?: string, stop?: boolean }}
   */
  evaluate(recipient) {
    if (this.ledger.isOptedOut(recipient.number)) {
      return { allowed: false, reason: 'pediu para nao receber mais mensagens' };
    }

    const last = this.ledger.lastContactAt(recipient.number);
    if (last !== null && this.config.cooldownDays > 0) {
      const days = (Date.now() - last) / DAY_MS;
      if (days < this.config.cooldownDays) {
        return {
          allowed: false,
          reason: `contatado ha ${Math.floor(days)} dia(s); intervalo minimo e ${this.config.cooldownDays}`,
        };
      }
    }

    const dailyLimit = this.effectiveDailyLimit();
    if (this.ledger.countToday() >= dailyLimit) {
      return { allowed: false, stop: true, reason: `limite diario de ${dailyLimit} mensagens atingido` };
    }

    if (this.ledger.countLastHour() >= this.config.hourlyLimit) {
      return { allowed: false, stop: true, reason: `limite de ${this.config.hourlyLimit} mensagens por hora atingido` };
    }

    if (!this.insideWindow()) {
      const horas = (this.msUntilWindow() / 3600000).toFixed(1);
      return {
        allowed: false,
        stop: true,
        reason: `fora da janela de envio (${this.config.windowStart}h-${this.config.windowEnd}h); faltam ${horas}h`,
      };
    }

    return { allowed: true };
  }

  registerSent() {
    this.sentInRun += 1;
    this.consecutiveFailures = 0;
  }

  /**
   * Falhas seguidas costumam ser o primeiro sinal de restricao na conta.
   * @returns {boolean} true quando a campanha deve parar
   */
  registerFailure() {
    this.consecutiveFailures += 1;
    return this.consecutiveFailures >= this.config.maxConsecutiveFailures;
  }

  /**
   * Intervalo ate o proximo envio. Uma cadencia uniforme e um dos sinais mais
   * faceis de detectar, entao a distribuicao e enviesada para intervalos curtos
   * com cauda longa, e a cada lote entra uma pausa de varios minutos.
   */
  nextDelay() {
    const { minDelay, maxDelay, batchSize, batchPauseMin, batchPauseMax } = this.config;

    if (batchSize > 0 && this.sentInRun > 0 && this.sentInRun % batchSize === 0) {
      const pause = randomBetween(batchPauseMin, batchPauseMax);
      return { ms: pause, kind: 'lote' };
    }

    const base = randomBetween(minDelay, maxDelay);
    // ~12% dos intervalos viram uma pausa longa, como alguem que se distrai.
    const distracted = Math.random() < 0.12;
    const ms = distracted ? Math.round(base * randomBetween(180, 320) / 100) : base;
    return { ms, kind: distracted ? 'pausa longa' : 'normal' };
  }

  /** Quantos envios ainda cabem hoje, considerando todos os limites. */
  remainingToday() {
    return Math.max(0, this.effectiveDailyLimit() - this.ledger.countToday());
  }

  describe() {
    return {
      ...this.config,
      effectiveDailyLimit: this.effectiveDailyLimit(),
      remainingToday: this.remainingToday(),
      insideWindow: this.insideWindow(),
      daysActive: this.ledger.daysActive(),
    };
  }
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Converte o que vem do formulario e aplica pisos de seguranca. */
function sanitize(config) {
  const out = {};
  const num = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  if (config.minDelay !== undefined) out.minDelay = Math.max(3000, num(config.minDelay, DEFAULTS.minDelay));
  if (config.maxDelay !== undefined) out.maxDelay = Math.max(out.minDelay ?? 3000, num(config.maxDelay, DEFAULTS.maxDelay));
  if (config.dailyLimit !== undefined) out.dailyLimit = Math.max(1, num(config.dailyLimit, DEFAULTS.dailyLimit));
  if (config.hourlyLimit !== undefined) out.hourlyLimit = Math.max(1, num(config.hourlyLimit, DEFAULTS.hourlyLimit));
  if (config.batchSize !== undefined) out.batchSize = Math.max(0, num(config.batchSize, DEFAULTS.batchSize));
  if (config.batchPauseMin !== undefined) out.batchPauseMin = Math.max(0, num(config.batchPauseMin, DEFAULTS.batchPauseMin));
  if (config.batchPauseMax !== undefined) out.batchPauseMax = Math.max(out.batchPauseMin ?? 0, num(config.batchPauseMax, DEFAULTS.batchPauseMax));
  if (config.windowStart !== undefined) out.windowStart = clampHour(num(config.windowStart, DEFAULTS.windowStart));
  if (config.windowEnd !== undefined) out.windowEnd = clampHour(num(config.windowEnd, DEFAULTS.windowEnd));
  if (config.cooldownDays !== undefined) out.cooldownDays = Math.max(0, num(config.cooldownDays, DEFAULTS.cooldownDays));
  if (config.respectWindow !== undefined) out.respectWindow = toBool(config.respectWindow);
  if (config.warmup !== undefined) out.warmup = toBool(config.warmup);
  return out;
}

function clampHour(value) {
  return Math.min(23, Math.max(0, Math.round(value)));
}

function toBool(value) {
  return !(value === false || value === 'false' || value === 0 || value === '0');
}

module.exports = { SafetyPolicy, DEFAULTS, warmupLimit };
