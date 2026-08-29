'use strict';

const fs = require('fs');
const { EventEmitter } = require('events');

const { renderTemplate } = require('./contact-name');

const DEFAULT_MIN_DELAY = 5000;
const DEFAULT_MAX_DELAY = 10000;

/** Intervalo dinamico e aleatorio entre disparos (regra anti-spam). */
function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Executa a campanha de disparo individual.
 * Um erro em um destinatario NUNCA interrompe o loop: registra a falha,
 * respeita o intervalo e segue para o proximo numero.
 */
class CampaignRunner extends EventEmitter {
  constructor({ whatsapp, logger }) {
    super();
    this.whatsapp = whatsapp;
    this.logger = logger;

    this.running = false;
    this.cancelRequested = false;
    this.wakeUp = null;
    this.state = this.emptyState();
  }

  emptyState() {
    return {
      running: false,
      groupName: null,
      total: 0,
      processed: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      current: null,
      startedAt: null,
      finishedAt: null,
      dryRun: false,
      failures: [],
    };
  }

  getState() {
    return { ...this.state, failures: this.state.failures.slice(-50) };
  }

  isRunning() {
    return this.running;
  }

  emitProgress() {
    this.emit('progress', this.getState());
  }

  /** Sleep cancelavel: o botao "Parar" nao precisa esperar o intervalo terminar. */
  sleep(ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.wakeUp = null;
        resolve();
      }, ms);
      this.wakeUp = () => {
        clearTimeout(timer);
        this.wakeUp = null;
        resolve();
      };
    });
  }

  stop() {
    if (!this.running) return false;
    this.cancelRequested = true;
    this.logger.warn('Parada solicitada. Encerrando apos a mensagem atual...');
    if (this.wakeUp) this.wakeUp();
    return true;
  }

  /**
   * @param {{
   *   recipients: Array<{id: string, number: string}>,
   *   groupName?: string,
   *   text?: string,
   *   mediaPath?: string|null,
   *   audioPath?: string|null,
   *   minDelay?: number,
   *   maxDelay?: number,
   *   validateNumbers?: boolean,
   *   dryRun?: boolean,
   *   onFinish?: Function
   * }} config
   */
  async start(config) {
    if (this.running) throw new Error('Ja existe uma campanha em andamento.');

    const {
      recipients = [],
      groupName = null,
      text = '',
      mediaPath = null,
      minDelay = DEFAULT_MIN_DELAY,
      maxDelay = DEFAULT_MAX_DELAY,
      validateNumbers = true,
      dryRun = false,
      personalize = true,
      fallbackName = '',
      onFinish = null,
    } = config;

    let audioPath = config.audioPath || null;

    if (!recipients.length) throw new Error('Nenhum destinatario informado.');
    if (!text && !mediaPath && !audioPath) {
      throw new Error('Informe ao menos um conteudo: texto, midia ou audio.');
    }

    const min = Math.max(1000, Number(minDelay) || DEFAULT_MIN_DELAY);
    const max = Math.max(min, Number(maxDelay) || DEFAULT_MAX_DELAY);

    this.running = true;
    this.cancelRequested = false;
    this.state = {
      ...this.emptyState(),
      running: true,
      groupName,
      total: recipients.length,
      startedAt: new Date().toISOString(),
      dryRun,
    };
    this.emitProgress();

    let convertedAudio = null;
    if (audioPath) {
      const prepared = await this.whatsapp.prepareVoiceFile(audioPath);
      if (prepared.converted) convertedAudio = prepared.path;
      audioPath = prepared.path;
    }

    const usesTemplate = /\{(nome|primeiro_nome|numero)\}/i.test(text);
    if (usesTemplate) {
      const comNome = recipients.filter((r) => r.name).length;
      this.logger.info(
        personalize
          ? `Personalizacao ligada: ${comNome} de ${recipients.length} destinatario(s) tem nome; ` +
            `os demais recebem a mensagem sem o nome${fallbackName ? ` ("${fallbackName}")` : ''}.`
          : `Personalizacao desligada: ninguem recebe o proprio nome${fallbackName ? ` (usando "${fallbackName}")` : ''}.`
      );
    }

    this.logger.info(
      `Campanha iniciada${groupName ? ` para o grupo "${groupName}"` : ''}: ` +
        `${recipients.length} destinatario(s), intervalo de ${min / 1000}s a ${max / 1000}s` +
        `${dryRun ? ' [SIMULACAO - nada sera enviado]' : ''}.`
    );

    try {
      for (let i = 0; i < recipients.length; i += 1) {
        if (this.cancelRequested) {
          this.logger.warn(`Campanha interrompida pelo usuario em ${i} de ${recipients.length}.`);
          break;
        }

        const recipient = recipients[i];
        this.state.current = recipient.number;
        this.emitProgress();

        try {
          await this.sendToRecipient(recipient, {
            text,
            mediaPath,
            audioPath,
            validateNumbers,
            dryRun,
            personalize,
            fallbackName,
          });
          this.state.sent += 1;
          const label = recipient.name ? `${recipient.name} (+${recipient.number})` : `+${recipient.number}`;
          this.logger.ok(
            `Enviado ${this.state.sent} de ${recipients.length} -> ${label}` +
              `${dryRun ? ' (simulado)' : ''}`
          );
        } catch (err) {
          // Falha em um numero nao derruba a automacao: loga e segue.
          const reason = err && err.message ? err.message : String(err);
          if (/nao possui WhatsApp|invalido/i.test(reason)) {
            this.state.skipped += 1;
            this.logger.warn(`Pulado +${recipient.number}: ${reason}`);
          } else {
            this.state.failed += 1;
            this.logger.error(`Falha ao enviar para +${recipient.number}: ${reason}`);
          }
          this.state.failures.push({ number: recipient.number, reason });
        }

        this.state.processed += 1;
        this.emitProgress();

        const isLast = i === recipients.length - 1;
        if (!isLast && !this.cancelRequested) {
          const wait = randomDelay(min, max);
          this.logger.info(`Aguardando ${(wait / 1000).toFixed(1)}s antes do proximo envio (anti-spam).`);
          await this.sleep(wait);
        }
      }
    } finally {
      this.running = false;
      this.state.running = false;
      this.state.current = null;
      this.state.finishedAt = new Date().toISOString();
      this.emitProgress();

      if (convertedAudio && fs.existsSync(convertedAudio)) {
        try {
          fs.unlinkSync(convertedAudio);
        } catch (_) {
          /* arquivo temporario; ignorar */
        }
      }

      this.logger.ok(
        `Campanha finalizada: ${this.state.sent} enviada(s), ` +
          `${this.state.failed} com erro, ${this.state.skipped} pulada(s).`
      );
      this.emit('finished', this.getState());
      if (typeof onFinish === 'function') {
        try {
          await onFinish(this.getState());
        } catch (err) {
          this.logger.warn(`Erro na limpeza pos-campanha: ${err.message}`);
        }
      }
    }

    return this.getState();
  }

  async sendToRecipient(recipient, opts) {
    const { text, mediaPath, audioPath, validateNumbers, dryRun, personalize, fallbackName } = opts;
    let chatId = recipient.id;

    if (validateNumbers) {
      chatId = await this.whatsapp.resolveRecipient(recipient.number);
    }

    // Cada destinatario recebe o texto com os marcadores ja substituidos.
    const body = renderTemplate(text, recipient, { personalize, fallbackName });

    if (dryRun) return;

    if (mediaPath) {
      // Texto vira legenda da midia para nao duplicar mensagens.
      await this.whatsapp.sendMedia(chatId, mediaPath, body || undefined);
    } else if (body) {
      await this.whatsapp.sendText(chatId, body);
    }

    if (audioPath) {
      await this.whatsapp.sendVoice(chatId, audioPath);
    }
  }
}

module.exports = { CampaignRunner, DEFAULT_MIN_DELAY, DEFAULT_MAX_DELAY };
