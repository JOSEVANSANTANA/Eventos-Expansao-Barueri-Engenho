'use strict';

/**
 * Logger unico para terminal + frontend.
 * Toda linha escrita aqui aparece no console do Node e no painel de logs da UI
 * (via socket.io), com o mesmo timestamp, para facilitar o diagnostico.
 */

const LEVELS = {
  info: { tag: 'INFO ', color: '\x1b[36m' },
  ok: { tag: 'OK   ', color: '\x1b[32m' },
  warn: { tag: 'WARN ', color: '\x1b[33m' },
  error: { tag: 'ERRO ', color: '\x1b[31m' },
};

const RESET = '\x1b[0m';

function timestamp() {
  return new Date().toLocaleTimeString('pt-BR', { hour12: false });
}

/**
 * @param {import('socket.io').Server} io
 * @param {{ historySize?: number }} [options]
 */
function createLogger(io, options = {}) {
  const historySize = options.historySize || 300;
  const history = [];

  function write(level, message) {
    const meta = LEVELS[level] || LEVELS.info;
    const time = timestamp();
    const entry = { time, level, message: String(message) };

    history.push(entry);
    if (history.length > historySize) history.shift();

    // eslint-disable-next-line no-console
    console.log(`${meta.color}[${time}] ${meta.tag}${RESET} ${entry.message}`);

    if (io) io.emit('log', entry);
    return entry;
  }

  return {
    info: (msg) => write('info', msg),
    ok: (msg) => write('ok', msg),
    warn: (msg) => write('warn', msg),
    error: (msg) => write('error', msg),
    history: () => history.slice(),
  };
}

module.exports = { createLogger };
