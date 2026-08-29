'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

/**
 * O WhatsApp so renderiza um audio como "mensagem de voz" (PTT) quando ele
 * chega em OGG/Opus mono. Um MP3 enviado com sendAudioAsVoice costuma cair
 * como arquivo anexado. Aqui tentamos converter com o ffmpeg do sistema;
 * se o ffmpeg nao existir, seguimos com o arquivo original (a lib ainda
 * tenta enviar como PTT, mas o resultado depende do formato de origem).
 */

function hasFfmpeg() {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
    proc.on('error', () => resolve(false));
    proc.on('close', (code) => resolve(code === 0));
  });
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`ffmpeg saiu com codigo ${code}: ${stderr.slice(-400)}`));
    });
  });
}

/**
 * Converte o audio para OGG/Opus mono 48kHz.
 * @param {string} filePath caminho do audio original
 * @param {{ info: Function, warn: Function }} logger
 * @returns {Promise<{ path: string, converted: boolean }>}
 */
async function ensureVoiceFormat(filePath, logger) {
  if (!filePath) return { path: null, converted: false };

  if (path.extname(filePath).toLowerCase() === '.ogg') {
    return { path: filePath, converted: false };
  }

  const available = await hasFfmpeg();
  if (!available) {
    logger.warn(
      'ffmpeg nao encontrado no PATH. O audio sera enviado no formato original ' +
        '(pode aparecer como arquivo em vez de mensagem de voz). Instale o ffmpeg para o modo PTT.'
    );
    return { path: filePath, converted: false };
  }

  const target = `${filePath}.ptt.ogg`;
  try {
    await runFfmpeg([
      '-y',
      '-i', filePath,
      '-vn',
      '-map_metadata', '-1',
      '-ac', '1',
      '-ar', '48000',
      '-c:a', 'libopus',
      '-b:a', '32k',
      target,
    ]);
    logger.info('Audio convertido para OGG/Opus (mensagem de voz).');
    return { path: target, converted: true };
  } catch (err) {
    logger.warn(`Falha ao converter o audio (${err.message}). Usando o arquivo original.`);
    if (fs.existsSync(target)) fs.unlinkSync(target);
    return { path: filePath, converted: false };
  }
}

module.exports = { ensureVoiceFormat };
