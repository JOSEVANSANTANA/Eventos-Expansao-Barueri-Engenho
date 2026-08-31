'use strict';

const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const qrcode = require('qrcode');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

const { ensureVoiceFormat } = require('./audio');
const { resolveContactName } = require('./contact-name');

/**
 * Erros vindos de dentro da pagina do WhatsApp Web chegam minificados ("r", "b")
 * ou como objeto solto. Aqui tentamos extrair algo que ajude no diagnostico.
 */
function describeError(err) {
  if (!err) return 'erro desconhecido';
  const message = typeof err === 'string' ? err : err.message || err.name || String(err);
  // Mensagens de 1-2 caracteres sao nome de funcao minificada: sem valor sozinhas.
  if (message.length > 2) return message;
  const firstFrame = (err.stack || '').split('\n')[1];
  return firstFrame ? `${message} (${firstFrame.trim()})` : `${message} (erro interno do WhatsApp Web)`;
}

/**
 * Palavras que caracterizam pedido de descadastro. A mensagem precisa ser curta
 * e conter o termo isolado: "sair" dentro de uma frase longa quase sempre e
 * outra coisa ("vou sair mais tarde").
 */
const OPT_OUT_PATTERN = /^(sair|parar|pare|stop|remover|descadastrar|cancelar|nao quero|nao enviar|me tira|me remova|sair da lista)\b[\s.!]*$/;

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
  constructor({ logger, sessionPath, headless = true, executablePath = null, ledger = null }) {
    super();
    this.logger = logger;
    this.ledger = ledger;
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

  /** Evita repetir o mesmo aviso a cada destinatario em grupos grandes. */
  warnOnce(key, message) {
    if (!this._warned) this._warned = new Set();
    if (this._warned.has(key)) return;
    this._warned.add(key);
    this.logger.warn(message);
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
    // O whatsapp-web.js reemite 'authenticated' varias vezes; nao poluimos o log
    // nem o socket quando nada mudou de fato.
    const unchanged = this.status === status && Object.keys(extra).length === 0;
    this.status = status;
    Object.assign(this, extra);
    if (!unchanged) this.emit('status', this.getStatus());
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
      if (this.status !== STATUS.AUTHENTICATED && this.status !== STATUS.READY) {
        this.logger.ok('Autenticado. Sincronizando conversas...');
      }
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
      // A lib reemite 'ready' varias vezes; so registramos a primeira.
      const jaEstavaPronto = this.status === STATUS.READY;
      this.setStatus(STATUS.READY);
      if (jaEstavaPronto) return;

      this.logger.ok(`Conectado como ${this.me?.name || 'usuario'} (${this.me?.number || 'numero desconhecido'}).`);

      try {
        const webVersion = await client.getWWebVersion();
        this.logger.info(`WhatsApp Web ${webVersion} | whatsapp-web.js ${require('whatsapp-web.js/package.json').version}`);
      } catch (_) {
        /* diagnostico opcional */
      }
    });

    // Quem pede para parar de receber e o sinal mais barato de respeitar - e o
    // que mais evita denuncia, que e o que de fato restringe a conta.
    client.on('message', async (message) => {
      try {
        if (!this.ledger) return;
        if (message.fromMe || message.isStatus) return;
        const from = String(message.from || '');
        if (!from.endsWith('@c.us')) return; // so conversas privadas

        const body = String(message.body || '')
          .trim()
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '');

        if (!OPT_OUT_PATTERN.test(body)) return;

        const number = from.split('@')[0];
        if (this.ledger.addOptOut(number, `respondeu "${String(message.body).trim().slice(0, 40)}"`)) {
          this.logger.warn(`+${number} pediu para nao receber mais mensagens e foi adicionado a lista de descadastro.`);
          this.emit('optout', { number, total: this.ledger.optOutList().length });
        }
      } catch (err) {
        this.logger.warn(`Erro ao processar resposta recebida: ${describeError(err)}`);
      }
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

  // ---------------------------------------------------------------------------
  // Leitura direta da pagina do WhatsApp Web.
  //
  // O client.getChats() do whatsapp-web.js monta o modelo completo de TODAS as
  // conversas de uma vez e, para cada grupo, dispara um groupMetadata.update()
  // e usa modulos internos do WhatsApp (WAWebLidMigrationUtils). Tudo isso roda
  // dentro de um Promise.all: basta um grupo falhar, ou um modulo ter mudado de
  // nome na versao do WhatsApp Web servida naquele dia, para a lista inteira ser
  // rejeitada com um erro minificado ("r").
  //
  // Para listar grupos nao precisamos de nada disso: id, nome e contagem bastam.
  // Estes metodos leem o minimo necessario, com try/catch por item.
  // ---------------------------------------------------------------------------

  /** @returns {Promise<{groups: Array, failed: number}>} */
  async listGroupsRaw() {
    return this.client.pupPage.evaluate(() => {
      const collections = () => {
        try {
          return window.require('WAWebCollections');
        } catch (_) {
          return null;
        }
      };

      let chats = null;
      const store = collections();
      try {
        chats = store ? store.Chat.getModelsArray() : window.Store.Chat.getModelsArray();
      } catch (err) {
        throw new Error(`Nao consegui acessar a lista de conversas do WhatsApp Web (${err && err.message}).`);
      }

      const groups = [];
      let failed = 0;

      for (const chat of chats || []) {
        try {
          const id = chat?.id?._serialized || (chat?.id?.toString ? chat.id.toString() : null);
          // Grupo se identifica pelo sufixo do id: dispensa carregar metadados.
          if (!id || !id.endsWith('@g.us')) continue;

          let name = null;
          try {
            name = chat.formattedTitle || chat.name || null;
          } catch (_) {
            name = null;
          }

          let participants = null;
          try {
            const list = chat.groupMetadata?.participants;
            participants = list?.length ?? list?.getModelsArray?.().length ?? null;
          } catch (_) {
            participants = null;
          }
          // Voce sempre e membro do proprio grupo, entao zero aqui quer dizer
          // "metadados ainda nao sincronizados", nao "grupo vazio".
          if (!participants) participants = null;

          groups.push({ id, name, participants, archived: Boolean(chat.archive) });
        } catch (_) {
          failed += 1;
        }
      }

      return { groups, failed };
    });
  }

  /** Metadados de UM grupo, sem passar pelo modelo completo da lib. */
  async getGroupParticipantsRaw(groupId) {
    return this.client.pupPage.evaluate(async (gid) => {
      const collections = window.require('WAWebCollections');
      const wid = window.require('WAWebWidFactory').createWid(gid);
      const GroupMetadata = collections.GroupMetadata || collections.WAWebGroupMetadataCollection;

      const chat = collections.Chat.get(wid);

      const readMeta = () => {
        try {
          return chat?.groupMetadata || GroupMetadata.get(wid) || null;
        } catch (_) {
          return null;
        }
      };

      const hasParticipants = (m) => {
        if (!m) return false;
        try {
          const list = m.participants;
          return Boolean(list?.length || list?.getModelsArray?.().length);
        } catch (_) {
          return false;
        }
      };

      // 1) o que ja esta em memoria (instantaneo e o caso comum)
      let meta = readMeta();

      // 2) forca a atualizacao pelo servidor
      if (!hasParticipants(meta)) {
        try {
          await GroupMetadata.update(wid);
        } catch (_) {
          /* segue para a proxima tentativa */
        }
        meta = readMeta();
      }

      // 3) ultimo recurso: carrega a colecao do zero
      if (!hasParticipants(meta)) {
        try {
          meta = (await GroupMetadata.find(wid)) || meta;
        } catch (_) {
          /* mantem o que tiver */
        }
      }

      if (!hasParticipants(meta)) {
        throw new Error(
          'Nao consegui carregar os participantes deste grupo. ' +
            'Abra a conversa no WhatsApp do celular uma vez e tente de novo.'
        );
      }

      // Converte @lid para o telefone real quando o modulo existir.
      let toPn = null;
      try {
        toPn = window.require('WAWebLidMigrationUtils').toPn;
      } catch (_) {
        toPn = null;
      }

      const raw = meta.participants?.getModelsArray?.() || meta.participants || [];
      const participants = [];

      for (const participant of raw) {
        try {
          let pid = participant.id;
          if (toPn) {
            try {
              pid = toPn(pid) ?? pid;
            } catch (_) {
              /* mantem o id original */
            }
          }
          const id = pid?._serialized || (pid?.toString ? pid.toString() : null);
          if (!id) continue;
          participants.push({ id, isAdmin: Boolean(participant.isAdmin || participant.isSuperAdmin) });
        } catch (_) {
          /* participante problematico nao derruba os demais */
        }
      }

      let name = null;
      try {
        name = chat?.formattedTitle || chat?.name || null;
      } catch (_) {
        name = null;
      }

      return { name, participants };
    }, groupId);
  }

  /** Normaliza o retorno da leitura direta para o mesmo formato da API. */
  async listGroupsFromPage() {
    const raw = await this.listGroupsRaw();
    if (raw.failed > 0) {
      this.logger.warn(`${raw.failed} conversa(s) nao puderam ser lidas e foram ignoradas.`);
    }
    return raw.groups.map((group) => ({
      id: group.id,
      name: group.name || 'Grupo sem nome',
      participants: group.participants,
      archived: group.archived,
    }));
  }

  /**
   * Lista os grupos do numero conectado.
   * Tenta a API oficial da lib e, se ela quebrar, cai na leitura direta.
   */
  async listGroups() {
    this.assertReady();

    let groups = [];
    try {
      const chats = await this.client.getChats();
      groups = chats
        .filter((chat) => chat.isGroup)
        .map((chat) => ({
          id: chat.id?._serialized,
          name: chat.name || 'Grupo sem nome',
          participants: Array.isArray(chat.participants) ? chat.participants.length : null,
          archived: Boolean(chat.archived),
        }));
      // A API pode nao lancar erro e ainda assim devolver nada: nesse caso a
      // leitura direta e a unica forma de saber se existem grupos mesmo.
      if (groups.length === 0) {
        this.logger.warn('A leitura padrao nao encontrou grupos; conferindo direto no WhatsApp Web...');
        groups = await this.listGroupsFromPage();
      }
    } catch (err) {
      this.logger.warn(
        `A leitura padrao de conversas falhou (${describeError(err)}). ` +
          'Usando leitura direta do WhatsApp Web...'
      );
      groups = await this.listGroupsFromPage();
    }

    groups = groups
      .filter((group) => Boolean(group.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

    this.logger.info(`${groups.length} grupo(s) encontrado(s).`);
    return groups;
  }

  /** Ids dos participantes de um grupo, pela API da lib ou pela leitura direta. */
  async fetchGroupMembers(groupId) {
    try {
      const chat = await this.client.getChatById(groupId);
      if (!chat || !chat.isGroup) throw new Error('O chat informado nao e um grupo.');

      const members = (chat.participants || [])
        .map((participant) => {
          const wid = participant.id || {};
          const id = wid._serialized || (wid.user ? `${wid.user}@c.us` : null);
          return id ? { id, isAdmin: Boolean(participant.isAdmin || participant.isSuperAdmin) } : null;
        })
        .filter(Boolean);

      if (members.length) return { groupName: chat.name, members };
      this.logger.warn('A API padrao nao retornou participantes; tentando leitura direta...');
    } catch (err) {
      this.logger.warn(
        `A leitura padrao do grupo falhou (${describeError(err)}). Usando leitura direta...`
      );
    }

    const raw = await this.getGroupParticipantsRaw(groupId);
    return {
      groupName: raw.name || 'Grupo',
      members: raw.participants.map((p) => ({ id: p.id, isAdmin: p.isAdmin })),
    };
  }

  /**
   * Extrai os participantes de um grupo, ja no formato pronto para envio.
   * Busca tambem o nome de cada contato (para personalizar a mensagem),
   * remove o proprio numero e elimina duplicados.
   */
  async getGroupParticipants(groupId) {
    this.assertReady();

    const { groupName, members } = await this.fetchGroupMembers(groupId);
    this.logger.info(`Lendo os dados de ${members.length} participante(s) de "${groupName}"...`);

    const myId = this.me?.id || null;
    const seen = new Set();
    const participants = [];
    let skippedUnresolved = 0;
    let named = 0;

    // Buscar contato a contato e em serie ficaria lento em grupos grandes;
    // processamos em blocos para equilibrar velocidade e carga na sessao.
    const CHUNK = 12;
    const contactLookups = { ok: 0, fail: 0 };
    let contactsBroken = false;
    let lastContactError = null;

    for (let i = 0; i < members.length; i += CHUNK) {
      const chunk = members.slice(i, i + CHUNK);

      const resolved = await Promise.all(
        chunk.map(async (entry) => {
          let contact = null;
          // Se a leitura de contatos estiver quebrada nesta sessao, nao adianta
          // insistir 200 vezes: seguimos so com os numeros.
          if (!contactsBroken) {
            try {
              contact = await this.client.getContactById(entry.id);
              contactLookups.ok += 1;
            } catch (err) {
              contactLookups.fail += 1;
              lastContactError = err;
            }
          }

          // Contas novas aparecem como @lid (identificador opaco); o telefone
          // real so vem pelo contato.
          let serialized = entry.id;
          if (serialized.endsWith('@lid')) {
            const realNumber = contact?.number || contact?.id?.user;
            serialized = realNumber ? `${realNumber}@c.us` : null;
          }
          if (!serialized) return null;

          const number = serialized.split('@')[0];
          const { name, firstName } = resolveContactName(contact, number);
          return { id: serialized, number, name, firstName, isAdmin: entry.isAdmin };
        })
      );

      for (const item of resolved) {
        if (!item) {
          skippedUnresolved += 1;
          continue;
        }
        if (item.id === myId || seen.has(item.id)) continue;
        seen.add(item.id);
        if (item.name) named += 1;
        participants.push(item);
      }

      // Dez tentativas, nenhuma bem-sucedida: a API de contatos nao esta
      // funcionando nesta versao do WhatsApp Web. Seguimos sem os nomes.
      if (!contactsBroken && contactLookups.ok === 0 && contactLookups.fail >= 10) {
        contactsBroken = true;
        this.logger.warn(
          `Nao foi possivel ler os nomes dos contatos (${describeError(lastContactError)}). ` +
            'A extracao continua apenas com os numeros.'
        );
      }

      if (members.length > 50 && (i + CHUNK) % 60 < CHUNK) {
        this.logger.info(`Extraindo... ${Math.min(i + CHUNK, members.length)} de ${members.length}`);
      }
    }

    if (skippedUnresolved > 0) {
      this.logger.warn(`${skippedUnresolved} participante(s) sem telefone visivel foram ignorados.`);
    }
    this.logger.ok(
      `Grupo "${groupName}": ${participants.length} numero(s) extraido(s), ` +
        `${named} com nome identificado` +
        `${participants.length - named > 0 ? ` e ${participants.length - named} sem nome` : ''}.`
    );

    return { groupId, groupName, participants, named };
  }

  /**
   * Sonda o WhatsApp Web de dentro da pagina e devolve um relatorio.
   *
   * Erros atravessam a fronteira do Puppeteer perdendo mensagem e pilha (viram
   * "r"). Rodando as sondas dentro da pagina conseguimos o erro real, com o
   * nome do modulo que falhou.
   */
  async runDiagnostics() {
    this.assertReady();

    const report = await this.client.pupPage.evaluate(async () => {
      const results = [];

      const probe = async (label, fn) => {
        try {
          results.push({ label, ok: true, detail: String(await fn()) });
        } catch (err) {
          const message = (err && err.message) || String(err);
          const frames = String((err && err.stack) || '')
            .split('\n')
            .slice(1, 3)
            .map((line) => line.trim())
            .join(' <- ');
          results.push({ label, ok: false, detail: frames ? `${message} | ${frames}` : message });
        }
      };

      const chats = () => window.require('WAWebCollections').Chat.getModelsArray();

      await probe('window.require', () => typeof window.require);
      await probe('WAWebCollections', () => `${Object.keys(window.require('WAWebCollections')).length} colecoes`);
      await probe('Chat.getModelsArray()', () => `${chats().length} conversas`);
      await probe('grupos visiveis', () => {
        const total = chats().filter((chat) => {
          try {
            return String(chat.id._serialized).endsWith('@g.us');
          } catch (_) {
            return false;
          }
        }).length;
        return `${total} grupos`;
      });
      await probe('WAWebWidFactory.createWid', () => typeof window.require('WAWebWidFactory').createWid);
      await probe('WAWebLidMigrationUtils.toPn', () => typeof window.require('WAWebLidMigrationUtils').toPn);
      await probe('colecao GroupMetadata', () => {
        const c = window.require('WAWebCollections');
        if (c.GroupMetadata) return 'GroupMetadata';
        if (c.WAWebGroupMetadataCollection) return 'WAWebGroupMetadataCollection';
        throw new Error('nenhuma das duas colecoes existe');
      });
      await probe('WWebJS.getChats() (API da lib)', async () => `${(await window.WWebJS.getChats()).length} chats`);

      // As duas sondas abaixo cobrem exatamente o que a extracao de
      // participantes faz, para saber se ela vai funcionar antes de tentar.
      const primeiroGrupo = () => {
        const alvo = chats().find((chat) => {
          try {
            return String(chat.id._serialized).endsWith('@g.us');
          } catch (_) {
            return false;
          }
        });
        if (!alvo) throw new Error('nenhum grupo carregado');
        return alvo;
      };

      await probe('metadados de um grupo', async () => {
        const grupo = primeiroGrupo();
        const collections = window.require('WAWebCollections');
        const wid = window.require('WAWebWidFactory').createWid(grupo.id._serialized);
        const GroupMetadata = collections.GroupMetadata || collections.WAWebGroupMetadataCollection;
        let meta = grupo.groupMetadata || GroupMetadata.get(wid);
        if (!meta) {
          await GroupMetadata.update(wid);
          meta = grupo.groupMetadata || GroupMetadata.get(wid);
        }
        const lista = meta?.participants;
        const total = lista?.length ?? lista?.getModelsArray?.().length ?? 0;
        return `${total} participantes em "${grupo.formattedTitle || grupo.name}"`;
      });

      await probe('leitura de nome de contato', async () => {
        const grupo = primeiroGrupo();
        const collections = window.require('WAWebCollections');
        const wid = window.require('WAWebWidFactory').createWid(grupo.id._serialized);
        const GroupMetadata = collections.GroupMetadata || collections.WAWebGroupMetadataCollection;
        const meta = grupo.groupMetadata || GroupMetadata.get(wid);
        const lista = meta?.participants?.getModelsArray?.() || meta?.participants || [];
        if (!lista.length) throw new Error('grupo sem participantes carregados');
        const alvo = lista[0].id?._serialized || String(lista[0].id);
        const contato = await window.WWebJS.getContact(alvo);
        return contato ? `ok (${contato.pushname || contato.name || 'sem nome publico'})` : 'contato nao encontrado';
      });

      return results;
    });

    this.logger.info('--- Diagnostico do WhatsApp Web ---');
    for (const item of report) {
      const line = `${item.ok ? 'OK' : 'FALHOU'}  ${item.label}: ${item.detail}`;
      if (item.ok) this.logger.info(line);
      else this.logger.error(line);
    }
    this.logger.info('--- fim do diagnostico ---');

    return report;
  }

  /** Confere se o numero tem WhatsApp e devolve o id canonico de envio. */
  async resolveRecipient(numberOrId) {
    const raw = String(numberOrId).split('@')[0].replace(/\D/g, '');
    if (!raw) throw new Error('Numero invalido.');

    let numberId;
    try {
      numberId = await this.client.getNumberId(raw);
    } catch (err) {
      // Uma falha tecnica na verificacao nao significa que o numero e invalido;
      // pular o contato por causa disso seria pior do que tentar o envio.
      this.warnOnce(
        'number-validation',
        `A verificacao previa de numeros nao esta funcionando (${describeError(err)}). ` +
          'Os envios seguem sem essa checagem.'
      );
      return `${raw}@c.us`;
    }

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

module.exports = { WhatsAppService, STATUS, describeError };

// Mantido por conveniencia para scripts externos que queiram limpar a sessao.
module.exports.clearSession = function clearSession(sessionPath) {
  if (fs.existsSync(sessionPath)) {
    fs.rmSync(sessionPath, { recursive: true, force: true });
  }
  return path.resolve(sessionPath);
};
