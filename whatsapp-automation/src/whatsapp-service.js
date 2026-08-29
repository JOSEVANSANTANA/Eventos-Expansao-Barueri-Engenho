'use strict';

const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const qrcode = require('qrcode');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

const { ensureVoiceFormat } = require('./audio');

/**
 * Estados possiveis da sessao. O frontend usa isso para decidir qual tela mostrar.
 * DISCONNECTED -> STARTING -> QR -> AUTHENTICATED -> READY
 */
const STATUS = {
  DISCONNECTED: 'DISCONNECTED',
  STARTING: 'STARTING',
  QR: 'QR',
  AUTHENTICATED: 'AUTHENTICATED',
  READY: 'READY',
  ERROR: 'ERROR',
};

class WhatsAppService extends EventEmitter {
  /**
   * @param {{ logger: any, sessionPath: string, headless?: boolean, executablePath?: string }} options
   */
  constructor({ logger, sessionPath, headless = true, executablePath = null }) {
    super();
    this.logger = logger;
    this.sessionPath = sessionPath;
    this.headless = headless;
    this.executablePath = executablePath;

    this.client = null;
    this.status = STATUS.DISCONNECTED;
    this.qrDataUrl = null;
    this.me = null;
    this.lastError = null;
    this.starting = false;
  }

  getStatus() {
    return {
      status: this.status,
      qr: this.qrDataUrl,
      me: this.me,
      lastError: this.lastError,
    };
  }

  setStatus(status, extra = {}) {
    this.status = status;
    Object.assign(this, extra);
    this.emit('status', this.getStatus());
  }

  /** Sobe o cliente do whatsapp-web.js e registra todos os listeners. */
  async start() {
    if (this.starting || this.client) {
      this.logger.warn('Sessao ja esta iniciada ou inicializando.');
      return this.getStatus();
    }

    this.starting = true;
    this.lastError = null;
    this.setStatus(STATUS.STARTING);
    this.logger.info('Inicializando cliente do WhatsApp (isso abre um Chromium em segundo plano)...');

    const puppeteerOptions = {
      headless: this.headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
      ],
    };
    if (this.executablePath) puppeteerOptions.executablePath = this.executablePath;

    const clientOptions = {
      authStrategy: new LocalAuth({ dataPath: this.sessionPath }),
      puppeteer: puppeteerOptions,
    };

    // Por padrao a lib resolve sozinha a versao do WhatsApp Web (cache local com
    // fallback para a mais recente). Se uma atualizacao do WhatsApp quebrar a
    // sessao, da para fixar um HTML conhecido via WWEBJS_VERSION_URL.
    // Ex.: https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1234567890.html
    if (process.env.WWEBJS_VERSION_URL) {
      clientOptions.webVersionCache = { type: 'remote', remotePath: process.env.WWEBJS_VERSION_URL };
      this.logger.info(`Usando versao fixa do WhatsApp Web: ${process.env.WWEBJS_VERSION_URL}`);
    }

    this.client = new Client(clientOptions);

    this.registerListeners();

    try {
      await this.client.initialize();
    } catch (err) {
      this.lastError = err.message;
      this.logger.error(`Falha ao inicializar o cliente: ${err.message}`);
      this.setStatus(STATUS.ERROR);
      await this.destroyClient();
    } finally {
      this.starting = false;
    }

    return this.getStatus();
  }

  registerListeners() {
    const client = this.client;

    client.on('qr', async (qr) => {
      try {
        this.qrDataUrl = await qrcode.toDataURL(qr, { margin: 1, width: 320 });
        this.logger.info('QR Code gerado. Escaneie com o WhatsApp do celular (Aparelhos conectados).');
        this.setStatus(STATUS.QR);
      } catch (err) {
        this.logger.error(`Nao foi possivel renderizar o QR Code: ${err.message}`);
      }
    });

    client.on('loading_screen', (percent, message) => {
      this.logger.info(`Carregando sessao: ${percent}% ${message || ''}`.trim());
    });

    client.on('authenticated', () => {
      this.qrDataUrl = null;
      this.logger.ok('Autenticado. Sincronizando conversas...');
      this.setStatus(STATUS.AUTHENTICATED);
    });

    client.on('auth_failure', (msg) => {
      this.lastError = msg;
      this.logger.error(`Falha de autenticacao: ${msg}`);
      this.setStatus(STATUS.ERROR);
    });

    client.on('ready', async () => {
      this.qrDataUrl = null;
      try {
        const info = client.info;
        this.me = {
          number: info?.wid?.user || null,
          name: info?.pushname || null,
          id: info?.wid?._serialized || null,
        };
      } catch (_) {
        this.me = null;
      }
      this.logger.ok(`Conectado como ${this.me?.name || 'usuario'} (${this.me?.number || 'numero desconhecido'}).`);
      this.setStatus(STATUS.READY);
    });

    client.on('disconnected', async (reason) => {
      this.logger.warn(`Sessao desconectada: ${reason}`);
      this.me = null;
      this.qrDataUrl = null;
      this.setStatus(STATUS.DISCONNECTED);
      await this.destroyClient();
    });
  }

  async destroyClient() {
    if (!this.client) return;
    const client = this.client;
    this.client = null;
    try {
      await client.destroy();
    } catch (err) {
      this.logger.warn(`Erro ao encerrar o cliente: ${err.message}`);
    }
  }

  /** Encerra a sessao e apaga as credenciais locais (exige novo QR). */
  async logout() {
    if (!this.client) {
      this.setStatus(STATUS.DISCONNECTED);
      return this.getStatus();
    }
    try {
      await this.client.logout();
      this.logger.info('Logout solicitado ao WhatsApp.');
    } catch (err) {
      this.logger.warn(`Logout falhou (${err.message}). Encerrando o cliente mesmo assim.`);
    }
    await this.destroyClient();
    this.me = null;
    this.qrDataUrl = null;
    this.setStatus(STATUS.DISCONNECTED);
    return this.getStatus();
  }

  assertReady() {
    if (this.status !== STATUS.READY || !this.client) {
      throw new Error('Sessao do WhatsApp nao esta pronta. Conecte-se antes de continuar.');
    }
  }

  /** Lista todos os grupos em que o numero conectado participa. */
  async listGroups() {
    this.assertReady();
    const chats = await this.client.getChats();
    const groups = chats
      .filter((chat) => chat.isGroup)
      .map((chat) => ({
        id: chat.id?._serialized,
        name: chat.name || 'Grupo sem nome',
        participants: Array.isArray(chat.participants) ? chat.participants.length : null,
        archived: Boolean(chat.archived),
      }))
      .filter((group) => Boolean(group.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

    this.logger.info(`${groups.length} grupo(s) encontrado(s).`);
    return groups;
  }

  /**
   * Extrai os participantes de um grupo, ja no formato pronto para envio.
   * Remove o proprio numero e duplicados.
   */
  async getGroupParticipants(groupId) {
    this.assertReady();
    const chat = await this.client.getChatById(groupId);
    if (!chat || !chat.isGroup) throw new Error('O chat informado nao e um grupo.');

    const myId = this.me?.id || null;
    const seen = new Set();
    const participants = [];
    let skippedUnresolved = 0;

    for (const participant of chat.participants || []) {
      const wid = participant.id || {};
      let serialized = wid._serialized || (wid.user ? `${wid.user}@c.us` : null);
      if (!serialized) continue;

      // Contas novas podem vir como @lid (identificador opaco). Tentamos
      // resolver o telefone real pelo contato; se nao der, pulamos.
      if (serialized.endsWith('@lid')) {
        try {
          const contact = await this.client.getContactById(serialized);
          const realNumber = contact?.number || contact?.id?.user;
          serialized = realNumber ? `${realNumber}@c.us` : null;
        } catch (_) {
          serialized = null;
        }
        if (!serialized) {
          skippedUnresolved += 1;
          continue;
        }
      }

      if (serialized === myId) continue;
      if (seen.has(serialized)) continue;
      seen.add(serialized);

      participants.push({
        id: serialized,
        number: serialized.split('@')[0],
        isAdmin: Boolean(participant.isAdmin || participant.isSuperAdmin),
      });
    }

    if (skippedUnresolved > 0) {
      this.logger.warn(`${skippedUnresolved} participante(s) sem telefone visivel foram ignorados.`);
    }
    this.logger.ok(`Grupo "${chat.name}": ${participants.length} numero(s) extraido(s).`);

    return { groupId, groupName: chat.name, participants };
  }

  /** Confere se o numero tem WhatsApp e devolve o id canonico de envio. */
  async resolveRecipient(numberOrId) {
    const raw = String(numberOrId).split('@')[0].replace(/\D/g, '');
    if (!raw) throw new Error('Numero invalido.');
    const numberId = await this.client.getNumberId(raw);
    if (!numberId) throw new Error('Numero nao possui WhatsApp.');
    return numberId._serialized;
  }

  async sendText(chatId, text) {
    this.assertReady();
    return this.client.sendMessage(chatId, text);
  }

  async sendMedia(chatId, filePath, caption) {
    this.assertReady();
    const media = MessageMedia.fromFilePath(filePath);
    const options = {};
    if (caption) options.caption = caption;
    return this.client.sendMessage(chatId, media, options);
  }

  /** Envia como PTT (mensagem de voz) sempre que o formato permitir. */
  async sendVoice(chatId, filePath) {
    this.assertReady();
    const media = MessageMedia.fromFilePath(filePath);
    return this.client.sendMessage(chatId, media, { sendAudioAsVoice: true });
  }

  /** Pre-processa o audio uma unica vez, antes do loop de disparo. */
  async prepareVoiceFile(filePath) {
    return ensureVoiceFormat(filePath, this.logger);
  }
}

module.exports = { WhatsAppService, STATUS };

// Mantido por conveniencia para scripts externos que queiram limpar a sessao.
module.exports.clearSession = function clearSession(sessionPath) {
  if (fs.existsSync(sessionPath)) {
    fs.rmSync(sessionPath, { recursive: true, force: true });
  }
  return path.resolve(sessionPath);
};
