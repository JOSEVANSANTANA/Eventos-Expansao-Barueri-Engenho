/* Painel do Cérebro de Operações — sem dependências externas. */

const $ = (id) => document.getElementById(id);

const EXEMPLO =
  "Pessoal, foi confirmado que haverá ceia na Estadual neste domingo, vamos gravar " +
  "vídeos ao final do culto para divulgar a Vigília. Lívia já mandou as referências, " +
  "Letícia vai fazer o roteiro hoje.";

let boards = [];
let pronto = false;

/* ------------------------------------------------------------------ helpers */
async function api(rota, opcoes = {}) {
  const resposta = await fetch(rota, {
    headers: { "Content-Type": "application/json" },
    ...opcoes,
  });
  const corpo = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    const detalhe =
      (corpo && (corpo.detail || corpo.erro)) || `HTTP ${resposta.status}`;
    throw new Error(typeof detalhe === "string" ? detalhe : JSON.stringify(detalhe));
  }
  return corpo;
}

function msg(elemento, texto, tipo) {
  elemento.textContent = texto || "";
  elemento.className = "msg" + (tipo ? ` msg-${tipo}` : "");
}

function escapar(texto) {
  const div = document.createElement("div");
  div.textContent = texto == null ? "" : String(texto);
  return div.innerHTML;
}

function formatarPrazo(iso) {
  if (!iso) return null;
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return null;
  return data.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ------------------------------------------------------------------- status */
async function carregarStatus() {
  const pill = $("pill-status");
  try {
    const status = await api("/api/status");
    $("env-path").textContent = status.env_path;
    $("rodape").textContent = `v${status.version} · modelo ${status.model || "?"}`;

    if (status.config_error) {
      pronto = false;
      pill.textContent = "configuração incompleta";
      pill.className = "pill pill-erro";
      mostrarAlerta("Falta preencher o .env", status.config_error);
      $("setup").classList.add("oculto");
      return;
    }
    if (status.trello_error) {
      pronto = false;
      pill.textContent = "Trello indisponível";
      pill.className = "pill pill-erro";
      mostrarAlerta("Não consegui falar com o Trello", status.trello_error);
      $("setup").classList.remove("oculto");
      return;
    }

    pronto = status.ready;
    esconderAlerta();
    $("setup").classList.toggle("oculto", pronto);

    if (pronto) {
      const nomes = [status.lists.ideias, status.lists.tarefas]
        .map((l) => (l && l.name) || "?")
        .join("  ·  ");
      pill.textContent = `pronto — ${nomes}`;
      pill.className = "pill pill-ok";
      carregarCards();
    } else {
      pill.textContent = `conectado como ${status.trello_user || "?"} — configure as listas`;
      pill.className = "pill pill-aviso";
      if (!boards.length) carregarBoards();
    }
  } catch (erro) {
    pronto = false;
    pill.textContent = "servidor fora do ar";
    pill.className = "pill pill-erro";
    mostrarAlerta("Sem resposta do servidor local", erro.message);
  }
}

function mostrarAlerta(titulo, texto) {
  $("alerta-titulo").textContent = titulo;
  $("alerta-texto").textContent = texto;
  $("alerta").classList.remove("oculto");
}

function esconderAlerta() {
  $("alerta").classList.add("oculto");
}

/* -------------------------------------------------------------------- setup */
async function carregarBoards() {
  const botao = $("btn-carregar-boards");
  botao.disabled = true;
  msg($("setup-msg"), "Buscando boards no Trello…");
  try {
    boards = await api("/api/boards");
    const sel = $("sel-board");
    sel.innerHTML = '<option value="">— escolha o board —</option>';
    boards.forEach((board, indice) => {
      const opcao = document.createElement("option");
      opcao.value = String(indice);
      opcao.textContent = board.name;
      sel.appendChild(opcao);
    });
    const expansao = boards.findIndex((b) => /expansao|expansão/i.test(b.name));
    if (expansao >= 0) {
      sel.value = String(expansao);
      preencherListas();
    }
    msg($("setup-msg"), `${boards.length} board(s) encontrados.`, "ok");
  } catch (erro) {
    msg($("setup-msg"), erro.message, "erro");
  } finally {
    botao.disabled = false;
  }
}

function preencherListas() {
  const indice = $("sel-board").value;
  const selIdeias = $("sel-ideias");
  const selTarefas = $("sel-tarefas");
  const listas = indice === "" ? [] : boards[Number(indice)].lists;

  [selIdeias, selTarefas].forEach((sel) => {
    sel.innerHTML = '<option value="">—</option>';
    listas.forEach((lista) => {
      const opcao = document.createElement("option");
      opcao.value = lista.id;
      opcao.textContent = lista.name;
      sel.appendChild(opcao);
    });
    sel.disabled = listas.length === 0;
  });

  // Palpite pelo nome da coluna, igual ao get_trello_lists.py.
  const acha = (regex) => (listas.find((l) => regex.test(l.name)) || {}).id || "";
  selIdeias.value = acha(/ideia|refer|inspira|banco|backlog/i);
  selTarefas.value = acha(/tarefa|fazer|todo|produ|execu/i);
  validarSetup();
}

function validarSetup() {
  const ideias = $("sel-ideias").value;
  const tarefas = $("sel-tarefas").value;
  $("btn-salvar-listas").disabled = !ideias || !tarefas || ideias === tarefas;
  if (ideias && ideias === tarefas) {
    msg($("setup-msg"), "As duas colunas precisam ser diferentes.", "erro");
  }
}

async function salvarListas() {
  const botao = $("btn-salvar-listas");
  botao.disabled = true;
  msg($("setup-msg"), "Gravando no .env…");
  try {
    await api("/api/config/lists", {
      method: "POST",
      body: JSON.stringify({
        ideias: $("sel-ideias").value,
        tarefas: $("sel-tarefas").value,
      }),
    });
    msg($("setup-msg"), "Configuração salva.", "ok");
    await carregarStatus();
  } catch (erro) {
    msg($("setup-msg"), erro.message, "erro");
    botao.disabled = false;
  }
}

/* ---------------------------------------------------------------- processar */
async function processar() {
  const texto = $("txt-mensagem").value.trim();
  if (!texto) {
    msg($("processar-msg"), "Escreva ou cole uma mensagem.", "erro");
    return;
  }
  const botao = $("btn-processar");
  botao.disabled = true;
  msg($("processar-msg"), "O Gemini está lendo a mensagem…");
  $("resultado").classList.add("oculto");

  try {
    const corpo = {
      text: texto,
      sender: $("inp-autor").value.trim() || null,
      group: $("inp-grupo").value.trim() || null,
    };
    const resultado = await api("/webhook", {
      method: "POST",
      body: JSON.stringify(corpo),
    });
    mostrarResultado(resultado);
    msg($("processar-msg"), "");
    $("txt-mensagem").value = "";
    carregarHistorico();
    if (resultado.status === "created") carregarCards();
  } catch (erro) {
    msg($("processar-msg"), erro.message, "erro");
    carregarHistorico();
  } finally {
    botao.disabled = false;
  }
}

function mostrarResultado(resultado) {
  const caixa = $("resultado");
  const etiqueta = `<span class="etiqueta etiqueta-${resultado.action_type}">${escapar(
    resultado.action_type
  )}</span>`;

  if (resultado.status === "ignored") {
    caixa.innerHTML = `${etiqueta}<h3>Nada foi criado</h3>
      <p>${escapar(resultado.detail || "Mensagem classificada como bate-papo.")}</p>`;
  } else {
    const prazo = formatarPrazo(resultado.due_date);
    caixa.innerHTML = `${etiqueta}<h3>${escapar(resultado.title)}</h3>
      ${prazo ? `<p>Prazo: ${escapar(prazo)}</p>` : ""}
      <p><a href="${escapar(resultado.card_url)}" target="_blank" rel="noopener">Abrir cartão no Trello →</a></p>`;
  }
  caixa.classList.remove("oculto");
}

/* --------------------------------------------------------------- board vivo */
async function carregarCards() {
  if (!pronto) return;
  const botao = $("btn-cards");
  botao.disabled = true;
  try {
    const dados = await api("/api/cards");
    desenharCards("lista-ideias", "cont-ideias", dados.ideias);
    desenharCards("lista-tarefas", "cont-tarefas", dados.tarefas);
  } catch (erro) {
    $("lista-ideias").innerHTML = `<li class="vazio">${escapar(erro.message)}</li>`;
    $("lista-tarefas").innerHTML = "";
  } finally {
    botao.disabled = false;
  }
}

function desenharCards(idLista, idContador, cards) {
  const ul = $(idLista);
  $(idContador).textContent = cards ? cards.length : 0;
  if (!cards || !cards.length) {
    ul.innerHTML = '<li class="vazio">Nenhum cartão nesta coluna.</li>';
    return;
  }
  const agora = Date.now();
  ul.innerHTML = cards
    .map((card) => {
      const prazo = formatarPrazo(card.due);
      const vencido = card.due && new Date(card.due).getTime() < agora;
      return `<li>
        <a href="${escapar(card.url)}" target="_blank" rel="noopener">${escapar(card.name)}</a>
        ${prazo ? `<span class="prazo ${vencido ? "prazo-vencido" : ""}">Prazo: ${escapar(prazo)}</span>` : ""}
      </li>`;
    })
    .join("");
}

/* ---------------------------------------------------------------- histórico */
async function carregarHistorico() {
  try {
    const itens = await api("/api/history");
    const ul = $("historico");
    if (!itens.length) {
      ul.innerHTML = '<li class="vazio">Nada processado ainda.</li>';
      return;
    }
    ul.innerHTML = itens
      .map((item) => {
        const etiqueta =
          item.status === "error"
            ? `<span class="etiqueta etiqueta-erro">falha · ${escapar(item.stage)}</span>`
            : `<span class="etiqueta etiqueta-${item.action_type}">${escapar(item.action_type)}</span>`;
        const titulo =
          item.status === "error"
            ? escapar(item.detail).slice(0, 240)
            : escapar(item.title || "");
        const link = item.card_url
          ? ` · <a href="${escapar(item.card_url)}" target="_blank" rel="noopener">abrir cartão</a>`
          : "";
        // Mensagem ignorada não tem título: mostra só a hora, a etiqueta e o texto.
        const linhaTitulo = titulo || link ? `<div class="titulo">${titulo}${link}</div>` : "";
        return `<li>
          <div class="cabecalho"><span class="hora">${escapar(item.at)}</span>${etiqueta}</div>
          ${linhaTitulo}
          <div class="texto">${escapar(item.text).slice(0, 180)}</div>
        </li>`;
      })
      .join("");
  } catch (erro) {
    /* silencioso: o status já sinaliza servidor fora do ar */
  }
}

async function limparHistorico() {
  await api("/api/history", { method: "DELETE" }).catch(() => {});
  carregarHistorico();
}

/* ----------------------------------------------------------------- encerrar */
async function encerrar() {
  if (!confirm("Encerrar o servidor local do Cérebro?")) return;
  await api("/api/shutdown", { method: "POST" }).catch(() => {});
  document.body.innerHTML =
    '<main><section class="cartao"><h2>Servidor encerrado</h2>' +
    '<p class="ajuda">Pode fechar esta aba. Para voltar, clique no app Cérebro de Operações.</p>' +
    "</section></main>";
}

/* -------------------------------------------------------------------- boot */
$("btn-atualizar").onclick = () => {
  carregarStatus();
  carregarHistorico();
};
$("btn-encerrar").onclick = encerrar;
$("btn-carregar-boards").onclick = carregarBoards;
$("sel-board").onchange = preencherListas;
$("sel-ideias").onchange = validarSetup;
$("sel-tarefas").onchange = validarSetup;
$("btn-salvar-listas").onclick = salvarListas;
$("btn-processar").onclick = processar;
$("btn-cards").onclick = carregarCards;
$("btn-limpar-historico").onclick = limparHistorico;
$("btn-exemplo").onclick = () => {
  $("txt-mensagem").value = EXEMPLO;
  $("inp-grupo").value = $("inp-grupo").value || "EXPANSAO OSASCO";
};
$("txt-mensagem").addEventListener("keydown", (evento) => {
  if ((evento.metaKey || evento.ctrlKey) && evento.key === "Enter") processar();
});

carregarStatus();
carregarHistorico();
setInterval(carregarStatus, 30000);
