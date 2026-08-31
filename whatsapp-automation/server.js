'use strict';

/**
 * Servidor local da automacao de WhatsApp.
 * - Express: serve a interface e a API REST
 * - Socket.io: QR Code, status da sessao, logs e progresso em tempo real
 * - whatsapp-web.js: sessao, grupos, participantes e disparo
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const multer = require('multer');
const { Server } = require('socket.io');

const { createLogger } = require('./src/logger');
const { WhatsAppService, STATUS, describeError } = require('./src/whatsapp-service');
const { CampaignRunner, DEFAULT_MIN_DELAY, DEFAULT_MAX_DELAY } = require('./src/campaign-runner');
const { Ledger } = require('./src/ledger');
const { SafetyPolicy, DEFAULTS: SAFETY_DEFAULTS } = require('./src/safety');

const APP_VERSION = require('./package.json').version;
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const SESSION_DIR = path.join(__dirname, '.wwebjs_auth');
const DATA_DIR = path.join(__dirname, 'data');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------------------------------------------------------------- infra base
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const logger = createLogger(io);
const ledger = new Ledger({ filePath: path.join(DATA_DIR, 'ledger.json'), logger });
const whatsapp = new WhatsAppService({
  logger,
  sessionPath: SESSION_DIR,
  headless: process.env.HEADLESS !== 'false',
  executablePath: process.env.CHROME_PATH || null,
  ledger,
});
const campaign = new CampaignRunner({ whatsapp, logger });

whatsapp.on('status', (status) => io.emit('status', status));
whatsapp.on('optout', () => io.emit('safety', safetySnapshot()));
campaign.on('progress', (state) => io.emit('campaign:progress', state));
campaign.on('finished', (state) => {
  io.emit('campaign:finished', state);
  io.emit('safety', safetySnapshot());
});

/** Estado dos limites, para a interface mostrar antes do disparo. */
function safetySnapshot(config = {}) {
  const policy = new SafetyPolicy(config, { ledger, logger });
  return { defaults: SAFETY_DEFAULTS, policy: policy.describe(), stats: ledger.stats() };
}

// ------------------------------------------------------------------- uploads
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-]/g, '_');
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}-${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 64 * 1024 * 1024 }, // 64 MB por arquivo
  fileFilter: (_req, file, cb) => {
    const allowed = {
      media: /^(image|video)\//,
      audio: /^(audio|video\/ogg)/,
    };
    const rule = allowed[file.fieldname];
    if (!rule) return cb(new Error(`Campo de arquivo inesperado: ${file.fieldname}`));
    if (!rule.test(file.mimetype)) {
      return cb(new Error(`Tipo de arquivo invalido para "${file.fieldname}": ${file.mimetype}`));
    }
    cb(null, true);
  },
});

function removeFiles(paths) {
  for (const filePath of paths.filter(Boolean)) {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (err) {
      logger.warn(`Nao foi possivel remover o arquivo temporario ${path.basename(filePath)}: ${err.message}`);
    }
  }
}

// -------------------------------------------------------------------- rotas
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/** Wrapper para nao repetir try/catch em toda rota async. */
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

app.get('/api/status', (_req, res) => {
  res.json({
    app: 'whatsapp-automation',
    version: APP_VERSION,
    ...whatsapp.getStatus(),
    campaign: campaign.getState(),
  });
});

app.post('/api/diagnostics', asyncRoute(async (_req, res) => {
  const report = await whatsapp.runDiagnostics();
  res.json({ version: APP_VERSION, report });
}));

app.post('/api/session/start', asyncRoute(async (_req, res) => {
  const status = await whatsapp.start();
  res.json(status);
}));

app.post('/api/session/logout', asyncRoute(async (_req, res) => {
  if (campaign.isRunning()) campaign.stop();
  const status = await whatsapp.logout();
  res.json(status);
}));

app.get('/api/safety', (_req, res) => {
  res.json(safetySnapshot());
});

app.get('/api/optouts', (_req, res) => {
  res.json({ optOuts: ledger.optOutList() });
});

app.post('/api/optouts', (req, res) => {
  const number = String(req.body?.number || '').replace(/\D/g, '');
  if (!number) return res.status(400).json({ error: 'Informe um numero valido.' });
  const added = ledger.addOptOut(number, 'adicionado manualmente');
  logger.info(`+${number} ${added ? 'adicionado a' : 'ja estava na'} lista de descadastro.`);
  res.json({ added, optOuts: ledger.optOutList() });
});

app.delete('/api/optouts/:number', (req, res) => {
  const number = String(req.params.number || '').replace(/\D/g, '');
  const removed = ledger.removeOptOut(number);
  if (removed) logger.info(`+${number} removido da lista de descadastro.`);
  res.json({ removed, optOuts: ledger.optOutList() });
});

app.get('/api/groups', asyncRoute(async (_req, res) => {
  const groups = await whatsapp.listGroups();
  res.json({ groups });
}));

app.get('/api/groups/:id/participants', asyncRoute(async (req, res) => {
  const data = await whatsapp.getGroupParticipants(req.params.id);
  res.json(data);
}));

app.post(
  '/api/campaign/start',
  upload.fields([
    { name: 'media', maxCount: 1 },
    { name: 'audio', maxCount: 1 },
  ]),
  asyncRoute(async (req, res) => {
    const mediaPath = req.files?.media?.[0]?.path || null;
    const audioPath = req.files?.audio?.[0]?.path || null;
    const uploaded = [mediaPath, audioPath];

    try {
      if (whatsapp.status !== STATUS.READY) {
        throw new Error('Sessao do WhatsApp nao esta conectada.');
      }
      if (campaign.isRunning()) {
        throw new Error('Ja existe uma campanha em andamento.');
      }

      const body = req.body || {};
      const text = (body.text || '').trim();
      const groupId = body.groupId || null;
      const dryRun = body.dryRun === 'true' || body.dryRun === true;
      const validateNumbers = !(body.validateNumbers === 'false' || body.validateNumbers === false);
      const minDelay = Number(body.minDelay) || DEFAULT_MIN_DELAY;
      const maxDelay = Number(body.maxDelay) || DEFAULT_MAX_DELAY;
      const personalize = !(body.personalize === 'false' || body.personalize === false);
      const fallbackName = (body.fallbackName || '').trim();
      const optOutFooter = (body.optOutFooter || '').trim();

      const safety = new SafetyPolicy(
        {
          minDelay,
          maxDelay,
          dailyLimit: body.dailyLimit,
          hourlyLimit: body.hourlyLimit,
          batchSize: body.batchSize,
          batchPauseMin: body.batchPauseMin,
          batchPauseMax: body.batchPauseMax,
          windowStart: body.windowStart,
          windowEnd: body.windowEnd,
          respectWindow: body.respectWindow,
          cooldownDays: body.cooldownDays,
          warmup: body.warmup,
        },
        { ledger, logger }
      );

      // A UI pode mandar a lista ja filtrada; senao, extraimos do grupo na hora.
      let recipients = [];
      let groupName = body.groupName || null;

      if (body.numbers) {
        const parsed = typeof body.numbers === 'string' ? JSON.parse(body.numbers) : body.numbers;
        recipients = (Array.isArray(parsed) ? parsed : [])
          .map((item) => (typeof item === 'string' ? { number: item.split('@')[0], id: item } : item))
          .filter((item) => item && item.number)
          .map((item) => ({
            id: item.id || `${item.number}@c.us`,
            number: String(item.number),
            name: item.name || null,
            firstName: item.firstName || null,
          }));
      } else if (groupId) {
        const data = await whatsapp.getGroupParticipants(groupId);
        recipients = data.participants;
        groupName = data.groupName;
      }

      if (!recipients.length) throw new Error('Nenhum destinatario valido para o disparo.');

      // Responde imediatamente; o andamento vai por socket.
      res.json({ started: true, total: recipients.length, groupName });

      campaign
        .start({
          recipients,
          groupName,
          text,
          mediaPath,
          audioPath,
          minDelay,
          maxDelay,
          validateNumbers,
          dryRun,
          personalize,
          fallbackName,
          groupId,
          safety,
          ledger,
          optOutFooter,
          onFinish: () => {
            removeFiles(uploaded);
            io.emit('safety', safetySnapshot());
          },
        })
        .catch((err) => {
          logger.error(`Campanha abortada: ${err.message}`);
          removeFiles(uploaded);
        });
    } catch (err) {
      removeFiles(uploaded);
      throw err;
    }
  })
);

app.post('/api/campaign/stop', (_req, res) => {
  const stopped = campaign.stop();
  res.json({ stopped, state: campaign.getState() });
});

app.get('/api/campaign/status', (_req, res) => {
  res.json(campaign.getState());
});

// Handler de erros unico: devolve JSON e loga no terminal + frontend.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const message = err instanceof multer.MulterError ? `Upload: ${err.message}` : describeError(err);
  logger.error(`API: ${message}`);
  res.status(400).json({ error: message });
});

// ------------------------------------------------------------------ sockets
io.on('connection', (socket) => {
  socket.emit('bootstrap', {
    version: APP_VERSION,
    status: whatsapp.getStatus(),
    safety: safetySnapshot(),
    campaign: campaign.getState(),
    logs: logger.history(),
  });

  socket.on('disconnect', () => {
    /* nada a fazer: o estado vive no servidor */
  });
});

// ----------------------------------------------------------------- shutdown
async function shutdown(signal) {
  logger.warn(`Recebido ${signal}. Encerrando...`);
  campaign.stop();
  await whatsapp.destroyClient();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  const message = describeError(reason);
  // Ao desconectar/reconectar, operacoes em voo morrem junto com a pagina.
  // Isso e esperado e nao merece alarme na tela do usuario.
  if (/Execution context was destroyed|Target closed|Session closed|Protocol error/i.test(message)) {
    logger.info(`Operacao interrompida pelo encerramento da sessao (${message}).`);
    return;
  }
  logger.error(`Promise rejeitada sem tratamento: ${message}`);
});

server.listen(PORT, HOST, () => {
  logger.ok(`Servidor rodando em http://${HOST}:${PORT} (versao ${APP_VERSION})`);
  logger.info('Abra o endereco no navegador e clique em "Conectar WhatsApp" para gerar o QR Code.');
});
