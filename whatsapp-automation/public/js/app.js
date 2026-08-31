/* eslint-env browser */
'use strict';

/**
 * Frontend vanilla: fala com a API REST e escuta o socket.io
 * para QR Code, status da sessao, logs e progresso do disparo.
 */

(function () {
  const socket = io();

  const el = (id) => document.getElementById(id);

  const ui = {
    statusDot: el('status-dot'),
    statusLabel: el('status-label'),
    btnConnect: el('btn-connect'),
    btnLogout: el('btn-logout'),

    authIdle: el('auth-idle'),
    authLoading: el('auth-loading'),
    authQr: el('auth-qr'),
    authReady: el('auth-ready'),
    qrImage: el('qr-image'),
    meName: el('me-name'),
    meNumber: el('me-number'),

    appVersion: el('app-version'),
    btnDiagnostics: el('btn-diagnostics'),
    btnRefreshGroups: el('btn-refresh-groups'),
    groupFilter: el('group-filter'),
    groupList: el('group-list'),

    extractCount: el('extract-count'),
    extractGroup: el('extract-group'),
    numbersBox: el('numbers-box'),
    btnCopyNumbers: el('btn-copy-numbers'),

    msgText: el('msg-text'),
    msgMedia: el('msg-media'),
    msgAudio: el('msg-audio'),
    optPersonalize: el('opt-personalize'),
    fallbackName: el('fallback-name'),
    fallbackField: el('fallback-field'),
    previewText: el('preview-text'),
    previewTarget: el('preview-target'),
    minDelay: el('min-delay'),
    maxDelay: el('max-delay'),
    optValidate: el('opt-validate'),
    optDryRun: el('opt-dry-run'),

    riskBadge: el('risk-badge'),
    riskNotes: el('risk-notes'),
    sfToday: el('sf-today'),
    sfRemaining: el('sf-remaining'),
    sfHour: el('sf-hour'),
    sfOptouts: el('sf-optouts'),
    sfDaily: el('sf-daily'),
    sfHourly: el('sf-hourly'),
    sfBatch: el('sf-batch'),
    sfBatchPause: el('sf-batch-pause'),
    sfWindowStart: el('sf-window-start'),
    sfWindowEnd: el('sf-window-end'),
    sfCooldown: el('sf-cooldown'),
    sfWindow: el('sf-window'),
    sfWarmup: el('sf-warmup'),
    sfOptoutFooter: el('sf-optout-footer'),
    sfOptoutCount: el('sf-optout-count'),
    sfOptoutList: el('sf-optout-list'),
    sfOptoutInput: el('sf-optout-input'),
    sfOptoutAdd: el('sf-optout-add'),
    btnStart: el('btn-start'),
    btnStop: el('btn-stop'),
    progressFill: el('progress-fill'),
    progressText: el('progress-text'),
    statSent: el('stat-sent'),
    statFailed: el('stat-failed'),
    statSkipped: el('stat-skipped'),
    statTotal: el('stat-total'),

    logBox: el('log-box'),
    btnClearLogs: el('btn-clear-logs'),
  };

  const state = {
    status: 'DISCONNECTED',
    groups: [],
    selectedGroup: null,
    recipients: [],
    running: false,
    safety: null,
  };

  // ------------------------------------------------------------- helpers
  async function api(url, options = {}) {
    const res = await fetch(url, options);
    let data = {};
    try {
      data = await res.json();
    } catch (_) {
      data = {};
    }
    if (!res.ok) throw new Error(data.error || `Erro HTTP ${res.status}`);
    return data;
  }

  function appendLog(entry) {
    const line = document.createElement('div');
    line.className = `log-line log-${entry.level}`;
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = `[${entry.time}]`;
    const msg = document.createElement('span');
    msg.className = 'msg';
    msg.textContent = entry.message;
    line.append(time, msg);

    const stuck = ui.logBox.scrollTop + ui.logBox.clientHeight >= ui.logBox.scrollHeight - 30;
    ui.logBox.appendChild(line);
    while (ui.logBox.childElementCount > 500) ui.logBox.removeChild(ui.logBox.firstChild);
    if (stuck) ui.logBox.scrollTop = ui.logBox.scrollHeight;
  }

  function localLog(message, level = 'info') {
    appendLog({ time: new Date().toLocaleTimeString('pt-BR', { hour12: false }), level, message });
  }

  // -------------------------------------------------------------- status
  const STATUS_LABEL = {
    DISCONNECTED: 'Desconectado',
    STARTING: 'Iniciando...',
    QR: 'Aguardando leitura do QR',
    AUTHENTICATED: 'Sincronizando...',
    READY: 'Conectado',
    ERROR: 'Erro na sessao',
  };

  function showAuthState(name) {
    ['authIdle', 'authLoading', 'authQr', 'authReady'].forEach((key) => {
      ui[key].hidden = key !== name;
    });
  }

  function renderStatus(payload) {
    state.status = payload.status;
    if (payload.version) ui.appVersion.textContent = `v${payload.version}`;
    ui.statusLabel.textContent = STATUS_LABEL[payload.status] || payload.status;

    ui.statusDot.className = 'dot';
    if (payload.status === 'READY') ui.statusDot.classList.add('ready');
    else if (payload.status === 'ERROR') ui.statusDot.classList.add('error');
    else if (payload.status !== 'DISCONNECTED') ui.statusDot.classList.add('pending');

    const ready = payload.status === 'READY';
    const busy = payload.status === 'STARTING' || payload.status === 'AUTHENTICATED' || payload.status === 'QR';

    ui.btnConnect.hidden = ready;
    ui.btnConnect.disabled = busy;
    ui.btnConnect.textContent = busy ? 'Conectando...' : 'Conectar WhatsApp';
    ui.btnLogout.hidden = !ready;

    ui.btnRefreshGroups.disabled = !ready;
    ui.btnDiagnostics.disabled = !ready;
    ui.groupFilter.disabled = !ready;

    if (payload.status === 'QR' && payload.qr) {
      ui.qrImage.src = payload.qr;
      showAuthState('authQr');
    } else if (ready) {
      ui.meName.textContent = payload.me?.name || '-';
      ui.meNumber.textContent = payload.me?.number ? `+${payload.me.number}` : '-';
      showAuthState('authReady');
    } else if (busy) {
      showAuthState('authLoading');
    } else {
      showAuthState('authIdle');
    }

    if (ready && !state.groups.length) loadGroups();
    if (!ready) {
      state.groups = [];
      state.recipients = [];
      renderGroups();
      renderRecipients(null);
    }
    updateStartButton();
  }

  // -------------------------------------------------------------- grupos
  async function loadGroups() {
    if (state.status !== 'READY') return;
    ui.groupList.innerHTML = '<li class="empty">Carregando grupos...</li>';
    try {
      const data = await api('/api/groups');
      state.groups = data.groups || [];
      renderGroups();
    } catch (err) {
      localLog(`Nao foi possivel listar os grupos: ${err.message}`, 'error');
      ui.groupList.innerHTML = '<li class="empty">Falha ao carregar. Tente atualizar.</li>';
    }
  }

  function renderGroups() {
    const term = ui.groupFilter.value.trim().toLowerCase();
    const list = state.groups.filter((g) => !term || g.name.toLowerCase().includes(term));

    ui.groupList.innerHTML = '';
    if (!list.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = state.status === 'READY' ? 'Nenhum grupo encontrado.' : 'Conecte-se para listar os grupos.';
      ui.groupList.appendChild(li);
      return;
    }

    for (const group of list) {
      const li = document.createElement('li');
      li.dataset.id = group.id;
      if (state.selectedGroup && state.selectedGroup.id === group.id) li.classList.add('selected');

      const name = document.createElement('span');
      name.className = 'group-name';
      name.textContent = group.name;

      const count = document.createElement('span');
      count.className = 'count';
      // Sem contagem = metadados ainda nao sincronizados pelo WhatsApp.
      count.textContent = group.participants ? `${group.participants} membros` : '';

      li.append(name, count);
      li.addEventListener('click', () => selectGroup(group));
      ui.groupList.appendChild(li);
    }
  }

  async function selectGroup(group) {
    if (state.running) {
      localLog('Aguarde a campanha atual terminar antes de trocar de grupo.', 'warn');
      return;
    }
    state.selectedGroup = group;
    renderGroups();

    ui.extractGroup.textContent = `Extraindo participantes de "${group.name}"...`;
    ui.numbersBox.value = '';
    ui.extractCount.textContent = '0';
    state.recipients = [];
    updateStartButton();

    try {
      const data = await api(`/api/groups/${encodeURIComponent(group.id)}/participants`);
      state.recipients = data.participants || [];
      renderRecipients(data.groupName);
    } catch (err) {
      localLog(`Falha ao extrair participantes: ${err.message}`, 'error');
      ui.extractGroup.textContent = 'Falha na extracao. Selecione o grupo novamente.';
    }
    updateStartButton();
  }

  function renderRecipients(groupName) {
    const total = state.recipients.length;
    const named = state.recipients.filter((p) => p.name).length;

    ui.extractCount.textContent = String(total);
    // Numero primeiro: assim "Copiar numeros" continua util para colar em planilha.
    ui.numbersBox.value = state.recipients
      .map((p) => `+${p.number}${p.name ? `  ${p.name}` : ''}`)
      .join('\n');
    ui.btnCopyNumbers.disabled = total === 0;

    if (!groupName) {
      ui.extractGroup.textContent = 'Selecione um grupo para extrair os participantes.';
    } else {
      const semNome = total - named;
      ui.extractGroup.textContent =
        `${total} participante(s) de "${groupName}" - ${named} com nome` +
        `${semNome > 0 ? `, ${semNome} sem nome` : ''}.`;
    }
    updatePreview();
  }

  // ----------------------------------------------------------- personalizacao
  /** Espelha renderTemplate() de src/contact-name.js, so para a previa na tela. */
  function applyTemplate(template, recipient, personalize, fallback) {
    const safeFallback = (fallback || '').trim();
    const name = personalize && recipient.name ? recipient.name : safeFallback;
    const first = personalize && (recipient.firstName || recipient.name)
      ? recipient.firstName || recipient.name
      : safeFallback;

    const rendered = template
      .replace(/\{nome\}/gi, name)
      .replace(/\{primeiro_nome\}/gi, first)
      .replace(/\{numero\}/gi, recipient.number ? `+${recipient.number}` : '');

    const removeuMarcador = (!name || !first) && /\{(nome|primeiro_nome)\}/i.test(template);
    if (!removeuMarcador) return rendered;

    return rendered
      .replace(/[^\S\n]{2,}/g, ' ')
      .replace(/[^\S\n]+([,.!?;:])/g, '$1')
      .replace(/(^|\n)[^\S\n]*[,;:][^\S\n]*/g, '$1')
      .replace(/[^\S\n]+\n/g, '\n')
      .trim();
  }

  function updatePreview() {
    const template = ui.msgText.value;
    const personalize = ui.optPersonalize.checked;
    ui.fallbackField.style.opacity = personalize ? '1' : '.55';

    if (!template.trim()) {
      ui.previewText.textContent = 'Escreva a mensagem para ver a previa.';
      ui.previewText.classList.add('placeholder');
      ui.previewTarget.textContent = 'primeiro destinatario';
      return;
    }

    // Se ha lista extraida, prefere mostrar alguem que realmente tenha nome.
    const sample =
      state.recipients.find((r) => r.name) ||
      state.recipients[0] || { name: 'Ana Beatriz', firstName: 'Ana', number: '5511999998888' };

    ui.previewTarget.textContent = sample.name
      ? `${sample.name} (+${sample.number})`
      : `+${sample.number} (sem nome)`;

    let preview = applyTemplate(template, sample, personalize, ui.fallbackName.value);

    // Se a lista tem gente sem nome, mostrar tambem como a mensagem chega para elas.
    const semNome = state.recipients.find((r) => !r.name);
    if (personalize && semNome && sample.name && /\{(nome|primeiro_nome)\}/i.test(template)) {
      preview += `\n\n--- para quem nao tem nome (+${semNome.number}) ---\n` +
        applyTemplate(template, semNome, personalize, ui.fallbackName.value);
    }

    ui.previewText.textContent = preview;
    ui.previewText.classList.remove('placeholder');
  }

  function insertToken(token) {
    const field = ui.msgText;
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? field.value.length;
    field.value = field.value.slice(0, start) + token + field.value.slice(end);
    field.focus();
    field.selectionStart = field.selectionEnd = start + token.length;
    updatePreview();
    updateStartButton();
  }

  // -------------------------------------------------------------- seguranca
  function safetyConfig() {
    return {
      dailyLimit: Number(ui.sfDaily.value) || 80,
      hourlyLimit: Number(ui.sfHourly.value) || 20,
      batchSize: Number(ui.sfBatch.value) || 0,
      batchPauseMin: (Number(ui.sfBatchPause.value) || 0) * 60000,
      batchPauseMax: Math.round((Number(ui.sfBatchPause.value) || 0) * 60000 * 1.6),
      windowStart: Number(ui.sfWindowStart.value) || 0,
      windowEnd: Number(ui.sfWindowEnd.value) || 23,
      respectWindow: ui.sfWindow.checked,
      cooldownDays: Number(ui.sfCooldown.value) || 0,
      warmup: ui.sfWarmup.checked,
    };
  }

  function renderSafety(payload) {
    if (!payload) return;
    state.safety = payload;

    const { stats = {}, policy = {} } = payload;
    ui.sfToday.textContent = stats.today ?? 0;
    ui.sfHour.textContent = stats.lastHour ?? 0;
    ui.sfOptouts.textContent = stats.optOuts ?? 0;
    ui.sfRemaining.textContent = policy.remainingToday ?? '-';
    ui.sfOptoutCount.textContent = stats.optOuts ?? 0;
    updateRisk();
  }

  /** Combina os sinais que de fato pesam numa restricao de conta. */
  function updateRisk() {
    const notes = [];
    let score = 0;

    const min = Number(ui.minDelay.value) || 0;
    if (min < 15) {
      score += 3;
      notes.push('intervalo minimo abaixo de 15s');
    } else if (min < 30) {
      score += 1;
      notes.push('intervalo minimo curto');
    }

    const daily = Number(ui.sfDaily.value) || 0;
    if (daily > 200) {
      score += 3;
      notes.push('mais de 200 mensagens por dia');
    } else if (daily > 100) {
      score += 1;
      notes.push('volume diario alto');
    }

    const texto = ui.msgText.value;
    const variantes = contarCombinacoes(texto);
    if (texto.trim() && variantes <= 1 && state.recipients.length > 10) {
      score += 2;
      notes.push('texto identico para todos');
    }

    if (!ui.sfOptoutFooter.value.trim()) {
      score += 1;
      notes.push('sem linha de descadastro');
    }

    if (!ui.sfWindow.checked) {
      score += 1;
      notes.push('sem janela de horario');
    }

    if (state.recipients.length) {
      const semNome = state.recipients.filter((r) => !r.name).length;
      const proporcao = semNome / state.recipients.length;
      if (proporcao > 0.7) {
        score += 2;
        notes.push(`${Math.round(proporcao * 100)}% sao desconhecidos`);
      }
    }

    const nivel = score >= 5 ? 'alto' : score >= 2 ? 'medio' : 'baixo';
    ui.riskBadge.textContent = `risco ${nivel}`;
    ui.riskBadge.className = `badge risk-${nivel}`;
    ui.riskNotes.textContent = notes.length
      ? `Pontos de atencao: ${notes.join('; ')}.`
      : 'Configuracao conservadora. Mesmo assim, aumente o volume aos poucos.';
  }

  /** Espelha countCombinations() de src/message-variants.js. */
  function contarCombinacoes(text) {
    if (!text) return 0;
    const variantes = String(text).split(/^\s*-{3,}\s*$/m).map((p) => p.trim()).filter(Boolean);
    let total = 0;
    for (const variante of variantes) {
      let combos = 1;
      for (const trecho of variante.match(/\{[^{}]*\|[^{}]*\}/g) || []) {
        combos *= trecho.slice(1, -1).split('|').length;
      }
      total += combos;
    }
    return total;
  }

  async function loadOptOuts() {
    try {
      const data = await api('/api/optouts');
      renderOptOuts(data.optOuts || []);
    } catch (_) {
      /* lista opcional */
    }
  }

  function renderOptOuts(list) {
    ui.sfOptoutCount.textContent = list.length;
    ui.sfOptoutList.innerHTML = '';

    for (const item of list) {
      const li = document.createElement('li');

      const number = document.createElement('span');
      number.textContent = `+${item.number}`;

      const reason = document.createElement('span');
      reason.className = 'reason';
      reason.textContent = item.reason || '';

      const remove = document.createElement('button');
      remove.className = 'remove';
      remove.textContent = 'x';
      remove.title = 'Remover da lista';
      remove.addEventListener('click', async () => {
        try {
          const data = await api(`/api/optouts/${item.number}`, { method: 'DELETE' });
          renderOptOuts(data.optOuts || []);
        } catch (err) {
          localLog(`Nao foi possivel remover: ${err.message}`, 'error');
        }
      });

      li.append(number, reason, remove);
      ui.sfOptoutList.appendChild(li);
    }
  }

  // ------------------------------------------------------------ campanha
  function updateStartButton() {
    const hasContent = Boolean(ui.msgText.value.trim() || ui.msgMedia.files.length || ui.msgAudio.files.length);
    ui.btnStart.disabled = state.running || state.status !== 'READY' || !state.recipients.length || !hasContent;
    ui.btnStop.disabled = !state.running;
  }

  function renderProgress(s) {
    state.running = Boolean(s.running);
    const total = s.total || 0;
    const done = s.processed || 0;
    const pct = total ? Math.round((done / total) * 100) : 0;

    ui.progressFill.style.width = `${pct}%`;
    ui.progressText.textContent = total
      ? `Enviado ${s.sent} de ${total}${s.current ? ` (processando +${s.current})` : ''}`
      : 'Enviado 0 de 0';

    ui.statSent.textContent = s.sent || 0;
    ui.statFailed.textContent = s.failed || 0;
    ui.statSkipped.textContent = s.skipped || 0;
    ui.statTotal.textContent = total;

    updateStartButton();
  }

  async function startCampaign() {
    if (!state.recipients.length) return;

    const min = Number(ui.minDelay.value) || 5;
    const max = Number(ui.maxDelay.value) || 10;
    if (max < min) {
      localLog('O intervalo maximo precisa ser maior ou igual ao minimo.', 'error');
      return;
    }
    const totalMin = ((state.recipients.length - 1) * min) / 60;
    const porDia = Number(ui.sfDaily.value) || 0;
    const restam = state.safety?.policy?.remainingToday;
    const named = state.recipients.filter((r) => r.name).length;
    const usaNome = /\{(nome|primeiro_nome)\}/i.test(ui.msgText.value);
    const confirmMsg =
      `Enviar para ${state.recipients.length} numero(s) do grupo "${state.selectedGroup?.name || '-'}"?\n` +
      `Tempo minimo estimado: ~${totalMin.toFixed(1)} minuto(s).` +
      (restam != null && state.recipients.length > restam
        ? `\n\nAtencao: so restam ${restam} envio(s) no limite de hoje. ` +
          `A campanha vai pausar sozinha ao atingir o teto e voce retoma amanha.`
        : '') +
      (usaNome && ui.optPersonalize.checked
        ? `\n\n${named} recebera(o) a mensagem com o proprio nome; ` +
          `${state.recipients.length - named} recebera(o) "${ui.fallbackName.value.trim() || 'tudo bem'}".`
        : '');
    if (!window.confirm(confirmMsg)) return;

    const form = new FormData();
    form.append('text', ui.msgText.value);
    form.append('groupId', state.selectedGroup?.id || '');
    form.append('groupName', state.selectedGroup?.name || '');
    form.append('numbers', JSON.stringify(state.recipients));
    form.append('minDelay', String(min * 1000));
    form.append('maxDelay', String(max * 1000));
    form.append('validateNumbers', ui.optValidate.checked ? 'true' : 'false');
    form.append('personalize', ui.optPersonalize.checked ? 'true' : 'false');
    form.append('fallbackName', ui.fallbackName.value);
    form.append('optOutFooter', ui.sfOptoutFooter.value);
    for (const [chave, valor] of Object.entries(safetyConfig())) form.append(chave, String(valor));
    form.append('dryRun', ui.optDryRun.checked ? 'true' : 'false');
    if (ui.msgMedia.files[0]) form.append('media', ui.msgMedia.files[0]);
    if (ui.msgAudio.files[0]) form.append('audio', ui.msgAudio.files[0]);

    ui.btnStart.disabled = true;
    try {
      await api('/api/campaign/start', { method: 'POST', body: form });
      state.running = true;
      updateStartButton();
    } catch (err) {
      localLog(`Nao foi possivel iniciar o disparo: ${err.message}`, 'error');
      updateStartButton();
    }
  }

  // -------------------------------------------------------------- eventos
  ui.btnConnect.addEventListener('click', async () => {
    ui.btnConnect.disabled = true;
    try {
      await api('/api/session/start', { method: 'POST' });
    } catch (err) {
      localLog(`Falha ao iniciar a sessao: ${err.message}`, 'error');
      ui.btnConnect.disabled = false;
    }
  });

  ui.btnLogout.addEventListener('click', async () => {
    if (!window.confirm('Encerrar a sessao? Sera necessario ler o QR Code novamente.')) return;
    try {
      await api('/api/session/logout', { method: 'POST' });
    } catch (err) {
      localLog(`Falha ao encerrar a sessao: ${err.message}`, 'error');
    }
  });

  ui.btnRefreshGroups.addEventListener('click', loadGroups);

  ui.btnDiagnostics.addEventListener('click', async () => {
    ui.btnDiagnostics.disabled = true;
    localLog('Rodando diagnostico... o resultado aparece abaixo.', 'info');
    try {
      await api('/api/diagnostics', { method: 'POST' });
    } catch (err) {
      localLog(`Diagnostico falhou: ${err.message}`, 'error');
    }
    ui.btnDiagnostics.disabled = state.status !== 'READY';
  });
  ui.groupFilter.addEventListener('input', renderGroups);

  ui.btnCopyNumbers.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(ui.numbersBox.value);
      localLog('Numeros copiados para a area de transferencia.', 'ok');
    } catch (_) {
      ui.numbersBox.select();
      document.execCommand('copy');
    }
  });

  [ui.msgText, ui.msgMedia, ui.msgAudio].forEach((input) => {
    input.addEventListener('input', updateStartButton);
    input.addEventListener('change', updateStartButton);
  });

  [ui.msgText, ui.fallbackName].forEach((input) => input.addEventListener('input', updatePreview));
  ui.optPersonalize.addEventListener('change', updatePreview);

  document.querySelectorAll('.chip[data-token]').forEach((chip) => {
    chip.addEventListener('click', () => insertToken(chip.dataset.token));
  });

  [ui.sfDaily, ui.sfHourly, ui.sfOptoutFooter, ui.minDelay, ui.maxDelay].forEach((input) =>
    input.addEventListener('input', updateRisk)
  );
  [ui.sfWindow, ui.sfWarmup].forEach((input) => input.addEventListener('change', updateRisk));
  ui.msgText.addEventListener('input', updateRisk);

  ui.sfOptoutAdd.addEventListener('click', async () => {
    const number = ui.sfOptoutInput.value.replace(/\D/g, '');
    if (!number) return;
    try {
      const data = await api('/api/optouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number }),
      });
      ui.sfOptoutInput.value = '';
      renderOptOuts(data.optOuts || []);
    } catch (err) {
      localLog(`Nao foi possivel adicionar: ${err.message}`, 'error');
    }
  });

  ui.btnStart.addEventListener('click', startCampaign);

  ui.btnStop.addEventListener('click', async () => {
    ui.btnStop.disabled = true;
    try {
      await api('/api/campaign/stop', { method: 'POST' });
    } catch (err) {
      localLog(`Falha ao parar: ${err.message}`, 'error');
      ui.btnStop.disabled = false;
    }
  });

  ui.btnClearLogs.addEventListener('click', () => {
    ui.logBox.innerHTML = '';
  });

  // -------------------------------------------------------------- sockets
  socket.on('bootstrap', (payload) => {
    ui.logBox.innerHTML = '';
    (payload.logs || []).forEach(appendLog);
    renderStatus({ ...payload.status, version: payload.version });
    renderSafety(payload.safety);
    renderProgress(payload.campaign);
    loadOptOuts();
  });

  socket.on('status', renderStatus);
  socket.on('safety', renderSafety);
  socket.on('log', appendLog);
  socket.on('campaign:progress', renderProgress);

  socket.on('campaign:finished', (s) => {
    renderProgress(s);
    if (s.failures && s.failures.length) {
      localLog(`Numeros com problema: ${s.failures.map((f) => `+${f.number}`).join(', ')}`, 'warn');
    }
  });

  socket.on('connect', () => localLog('Conectado ao servidor local.', 'ok'));
  socket.on('disconnect', () => localLog('Conexao com o servidor perdida. Reconectando...', 'warn'));

  updatePreview();
  updateRisk();

  // Estado inicial caso o socket demore a responder.
  api('/api/status')
    .then((data) => {
      renderStatus(data);
      renderProgress(data.campaign);
    })
    .catch(() => localLog('Servidor ainda inicializando...', 'warn'));
})();
