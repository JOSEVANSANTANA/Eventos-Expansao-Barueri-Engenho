'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Historico persistente de envios e lista de descadastro.
 *
 * Serve a tres propositos:
 *   1. impor limites diarios/horarios que sobrevivem a reinicios do app;
 *   2. evitar contatar a mesma pessoa varias vezes em poucos dias;
 *   3. respeitar quem pediu para parar de receber.
 *
 * Guardamos apenas telefone e data - nada de conteudo de mensagem.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_DAYS = 120;

class Ledger {
  constructor({ filePath, logger }) {
    this.filePath = filePath;
    this.logger = logger;
    this.data = { sends: [], optOuts: {}, firstSendAt: null };
    this.saveTimer = null;
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        this.data = {
          sends: Array.isArray(parsed.sends) ? parsed.sends : [],
          optOuts: parsed.optOuts && typeof parsed.optOuts === 'object' ? parsed.optOuts : {},
          firstSendAt: parsed.firstSendAt || null,
        };
        this.prune();
      }
    } catch (err) {
      // Um historico corrompido nao pode impedir o app de abrir.
      this.logger?.warn(`Historico de envios ilegivel (${err.message}). Comecando um novo.`);
      this.data = { sends: [], optOuts: {}, firstSendAt: null };
    }
  }

  prune() {
    const cutoff = Date.now() - RETENTION_DAYS * DAY_MS;
    this.data.sends = this.data.sends.filter((entry) => entry.at >= cutoff);
  }

  /** Grava em disco de forma agrupada: um disparo faz dezenas de chamadas. */
  save({ immediate = false } = {}) {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    const write = () => {
      this.saveTimer = null;
      try {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        fs.writeFileSync(this.filePath, JSON.stringify(this.data));
      } catch (err) {
        this.logger?.warn(`Nao foi possivel gravar o historico: ${err.message}`);
      }
    };
    if (immediate) return write();
    this.saveTimer = setTimeout(write, 2000);
    this.saveTimer.unref?.();
  }

  record(number, meta = {}) {
    const at = Date.now();
    if (!this.data.firstSendAt) this.data.firstSendAt = at;
    this.data.sends.push({ number: String(number), at, group: meta.groupId || null });
    this.save();
  }

  countSince(sinceMs) {
    const cutoff = Date.now() - sinceMs;
    return this.data.sends.reduce((total, entry) => total + (entry.at >= cutoff ? 1 : 0), 0);
  }

  countToday() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const from = start.getTime();
    return this.data.sends.reduce((total, entry) => total + (entry.at >= from ? 1 : 0), 0);
  }

  countLastHour() {
    return this.countSince(60 * 60 * 1000);
  }

  /** Timestamp do ultimo envio para um numero, ou null. */
  lastContactAt(number) {
    const target = String(number);
    let last = null;
    for (const entry of this.data.sends) {
      if (entry.number === target && (last === null || entry.at > last)) last = entry.at;
    }
    return last;
  }

  /** Dias completos desde o primeiro envio - base do modo aquecimento. */
  daysActive() {
    if (!this.data.firstSendAt) return 0;
    return Math.floor((Date.now() - this.data.firstSendAt) / DAY_MS);
  }

  // ------------------------------------------------------------ descadastro
  addOptOut(number, reason = 'pedido do destinatario') {
    const key = String(number);
    if (this.data.optOuts[key]) return false;
    this.data.optOuts[key] = { at: Date.now(), reason };
    this.save({ immediate: true });
    return true;
  }

  removeOptOut(number) {
    const key = String(number);
    if (!this.data.optOuts[key]) return false;
    delete this.data.optOuts[key];
    this.save({ immediate: true });
    return true;
  }

  isOptedOut(number) {
    return Boolean(this.data.optOuts[String(number)]);
  }

  optOutList() {
    return Object.entries(this.data.optOuts)
      .map(([number, info]) => ({ number, ...info }))
      .sort((a, b) => b.at - a.at);
  }

  stats() {
    return {
      today: this.countToday(),
      lastHour: this.countLastHour(),
      last24h: this.countSince(DAY_MS),
      last7d: this.countSince(7 * DAY_MS),
      total: this.data.sends.length,
      optOuts: Object.keys(this.data.optOuts).length,
      daysActive: this.daysActive(),
      firstSendAt: this.data.firstSendAt,
    };
  }
}

module.exports = { Ledger, DAY_MS };
