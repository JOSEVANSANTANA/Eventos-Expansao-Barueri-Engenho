'use strict';

const fs = require('fs');
const { EventEmitter } = require('events');

const { renderTemplate } = require('./contact-name');
const { pickVariant, appendOptOut, countCombinations } = require('./message-variants');

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
      stoppedReason: null,
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
      safety = null,
      ledger = null,
      optOutFooter = '',
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

    const combos = countCombinations(text);
    if (text && combos <= 1 && recipients.length > 10) {
      this.logger.warn(
        'A mensagem nao tem variacao: todos receberao um texto identico, ' +
          'que e um dos sinais mais faceis de detectar. Considere usar {opcao A|opcao B}.'
      );
    } else if (combos > 1) {
      this.logger.info(`Mensagem com ${combos} combinacao(oes) possiveis de texto.`);
    }

    if (safety) {
      const limite = safety.effectiveDailyLimit();
      this.logger.info(
        `Limites ativos: ${safety.remainingToday()} envio(s) restantes hoje ` +
          `(teto ${limite === Infinity ? 'sem teto' : limite}), ` +
          `${safety.config.hourlyLimit}/hora, lote de ${safety.config.batchSize}.`
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

        // A politica decide antes de qualquer chamada ao WhatsApp.
        if (safety) {
          const verdict = safety.evaluate(recipient);
          if (!verdict.allowed) {
            if (verdict.stop) {
              this.state.stoppedReason = verdict.reason;
              this.logger.warn(`Campanha pausada: ${verdict.reason}.`);
              this.logger.info(
                `${recipients.length - i} destinatario(s) nao foram contatados. ` +
                  'Retome mais tarde: o historico e preservado e ninguem recebe duas vezes.'
              );
              break;
            }
            this.state.skipped += 1;
            this.state.processed += 1;
            this.logger.info(`Pulado +${recipient.number}: ${verdict.reason}.`);
            this.state.failures.push({ number: recipient.number, reason: verdict.reason });
            this.emitProgress();
            continue;
          }
        }

        try {
          await this.sendToRecipient(recipient, {
            text,
            mediaPath,
            audioPath,
            validateNumbers,
            dryRun,
            personalize,
            fallbackName,
            optOutFooter,
          });
          this.state.sent += 1;
          if (safety) safety.registerSent();
          if (ledger && !dryRun) ledger.record(recipient.number, { groupId: config.groupId || null });
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

            // Falhas em sequencia sao o primeiro sintoma de uma conta restringida.
            if (safety && safety.registerFailure()) {
              this.state.stoppedReason = 'falhas consecutivas - possivel restricao na conta';
              this.logger.error(
                `${safety.config.maxConsecutiveFailures} falhas seguidas. Parando por seguranca: ` +
                  'isso costuma indicar restricao na conta. Confira o WhatsApp no celular antes de tentar de novo.'
              );
              this.state.processed += 1;
              this.emitProgress();
              break;
            }
          }
          this.state.failures.push({ number: recipient.number, reason });
        }

        this.state.processed += 1;
        this.emitProgress();

        const isLast = i === recipients.length - 1;
        if (!isLast && !this.cancelRequested) {
          const next = safety ? safety.nextDelay() : { ms: randomDelay(min, max), kind: 'normal' };
          const segundos = next.ms / 1000;
          const texto = segundos >= 90 ? `${(segundos / 60).toFixed(1)} min` : `${segundos.toFixed(1)}s`;
          this.logger.info(
            next.kind === 'lote'
              ? `Fim do lote. Pausa longa de ${texto} antes de continuar.`
              : `Aguardando ${texto} antes do proximo envio${next.kind === 'pausa longa' ? ' (pausa estendida)' : ''}.`
          );
          await this.sleep(next.ms);
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
          `${this.state.failed} com erro, ${this.state.skipped} pulada(s)` +
          `${this.state.stoppedReason ? ` - interrompida: ${this.state.stoppedReason}` : ''}.`
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

    // Ordem importa: sorteia a variante, resolve os marcadores e so entao
    // acrescenta o descadastro, que nunca deve ser sorteado fora.
    const variant = pickVariant(text);
    const rendered = renderTemplate(variant, recipient, { personalize, fallbackName });
    const body = appendOptOut(rendered, opts.optOutFooter);

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
