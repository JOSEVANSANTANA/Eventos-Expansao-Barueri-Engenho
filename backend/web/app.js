/* Painel do Cérebro de Operações — sem dependências externas. */

const $ = (id) => document.getElementById(id);

const EXEMPLO =
  "Pessoal, foi confirmado que haverá ceia na Estadual neste domingo, vamos gravar " +
  "vídeos ao final do culto para divulgar a Vigília. Lívia já mandou as referências, " +
  "Letícia vai fazer o roteiro hoje.";

let boards = [];
let pronto = false;
let ideiasGeradas = [];

/* ------------------------------------------------------------------- token */
// Acesso pela rede: o token vem na URL uma vez e fica guardado neste aparelho.
function lerToken() {
  const naUrl = new URLSearchParams(location.search).get("token");
  if (naUrl) {
    localStorage.setItem("cerebro_token", naUrl);
    history.replaceState({}, "", location.pathname);
    return naUrl;
  }
  return localStorage.getItem("cerebro_token") || "";
}
const TOKEN = lerToken();

/* ------------------------------------------------------------------ helpers */
async function api(rota, opcoes = {}) {
  const cabecalhos = { "Content-Type": "application/json", ...(opcoes.headers || {}) };
  if (TOKEN) cabecalhos["X-Cerebro-Token"] = TOKEN;

  const resposta = await fetch(rota, { ...opcoes, headers: cabecalhos });
  const corpo = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    const detalhe = (corpo && (corpo.detail || corpo.erro)) || `HTTP ${resposta.status}`;
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
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

function formatarHora(iso) {
  if (!iso) return "";
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return String(iso).slice(11, 19);
  return data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/* --------------------------------------------------------------------- abas */
document.querySelectorAll(".aba").forEach((aba) => {
  aba.onclick = () => {
    document.querySelectorAll(".aba").forEach((b) => b.classList.remove("ativa"));
    document.querySelectorAll(".painel").forEach((p) => p.classList.add("oculto"));
    aba.classList.add("ativa");
    $(aba.dataset.alvo).classList.remove("oculto");
  };
});

/* ------------------------------------------------------------------- status */
async function carregarStatus() {
  const pill = $("pill-status");
  try {
    const status = await api("/api/status");
    $("env-path").textContent = status.env_path;
    $("rodape").textContent = `v${status.version} · modelo ${status.model || "?"}`;
    desenharFila(status.fila);
    desenharWhatsApp(status.whatsapp);
    desenharRede(status.rede, status.whatsapp);

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
    pill.textContent = erro.message.includes("Token") ? "sem autorização" : "servidor fora do ar";
    pill.className = "pill pill-erro";
    mostrarAlerta("Não consegui falar com o servidor", erro.message);
  }
}

function desenharFila(fila) {
  const pill = $("pill-fila");
  if (!fila || (!fila.pendentes && !fila.erros)) {
    pill.classList.add("oculto");
    return;
  }
  const partes = [];
  if (fila.pendentes) partes.push(`${fila.pendentes} na fila`);
  if (fila.erros) partes.push(`${fila.erros} com erro`);
  pill.textContent = partes.join(" · ");
  pill.className = "pill " + (fila.erros ? "pill-erro" : "pill-aviso");
  pill.classList.remove("oculto");
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
      body: JSON.stringify({ ideias: $("sel-ideias").value, tarefas: $("sel-tarefas").value }),
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
    const resultado = await api("/webhook", {
      method: "POST",
      body: JSON.stringify({
        text: texto,
        sender: $("inp-autor").value.trim() || null,
        group: $("inp-grupo").value.trim() || null,
      }),
    });
    mostrarResultado(resultado);
    msg($("processar-msg"), "");
    $("txt-mensagem").value = "";
    if (resultado.status === "created") carregarCards();
  } catch (erro) {
    msg($("processar-msg"), erro.message, "erro");
  } finally {
    botao.disabled = false;
    carregarHistorico();
    carregarStatus();
  }
}

function mostrarResultado(resultado) {
  const caixa = $("resultado");
  const etiqueta = `<span class="etiqueta etiqueta-${resultado.action_type}">${escapar(
    resultado.action_type
  )}</span>`;

  if (resultado.status !== "created") {
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
const ETIQUETAS = {
  criado: (item) => `<span class="etiqueta etiqueta-${item.action_type || "tarefa"}">${escapar(
    item.action_type || "criado"
  )}</span>`,
  ignorado: () => '<span class="etiqueta etiqueta-ignorar">ignorar</span>',
  pendente: (item) =>
    `<span class="etiqueta etiqueta-pendente">na fila${
      item.tentativas ? ` · ${item.tentativas}ª tentativa` : ""
    }</span>`,
  erro: (item) => `<span class="etiqueta etiqueta-erro">falha · ${escapar(item.stage || "?")}</span>`,
};

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
        const etiqueta = (ETIQUETAS[item.status] || ETIQUETAS.pendente)(item);
        const origem =
          item.origem === "whatsapp"
            ? '<span class="origem">WhatsApp</span>'
            : '<span class="origem">painel</span>';
        const link = item.card_url
          ? ` · <a href="${escapar(item.card_url)}" target="_blank" rel="noopener">abrir cartão</a>`
          : "";
        const titulo = item.titulo ? `${escapar(item.titulo)}${link}` : "";
        const erro = item.ultimo_erro
          ? `<div class="erro-detalhe">${escapar(item.ultimo_erro).slice(0, 200)}</div>`
          : "";
        return `<li>
          <div class="cabecalho">
            <span class="hora">${escapar(formatarHora(item.recebida_em))}</span>
            ${etiqueta}${origem}
            ${item.autor ? `<span class="autor">${escapar(item.autor)}</span>` : ""}
          </div>
          ${titulo ? `<div class="titulo">${titulo}</div>` : ""}
          <div class="texto">${escapar(item.texto).slice(0, 180)}</div>
          ${erro}
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
  carregarStatus();
}

async function reprocessarFila() {
  const botao = $("btn-reprocessar");
  botao.disabled = true;
  try {
    const resultado = await api("/api/fila/reprocessar", { method: "POST" });
    botao.textContent = `${resultado.mensagens} de volta na fila`;
    setTimeout(() => (botao.textContent = "Reprocessar fila"), 3000);
  } finally {
    botao.disabled = false;
    carregarHistorico();
    carregarStatus();
  }
}

/* ------------------------------------------------------------------ estúdio */
async function gerarIdeias() {
  const tema = $("inp-tema").value.trim();
  if (tema.length < 3) {
    msg($("estudio-msg"), "Descreva o tema em algumas palavras.", "erro");
    return;
  }
  const botao = $("btn-gerar");
  botao.disabled = true;
  msg($("estudio-msg"), "O Gemini está criando…");
  try {
    const resposta = await api("/api/estudio/ideias", {
      method: "POST",
      body: JSON.stringify({
        tema,
        quantidade: Number($("sel-quantidade").value),
        usar_board: $("chk-board").checked,
      }),
    });
    ideiasGeradas = resposta.ideias || [];
    desenharIdeias();
    msg($("estudio-msg"), `${ideiasGeradas.length} ideia(s) — marque o que quer criar.`, "ok");
  } catch (erro) {
    msg($("estudio-msg"), erro.message, "erro");
  } finally {
    botao.disabled = false;
  }
}

function desenharIdeias() {
  const caixa = $("ideias-geradas");
  if (!ideiasGeradas.length) {
    caixa.classList.add("oculto");
    $("ideias-acoes").classList.add("oculto");
    return;
  }
  caixa.innerHTML = ideiasGeradas
    .map((ideia, indice) => {
      const prazo = formatarPrazo(ideia.due_date);
      const marcas = [ideia.formato, ideia.esforco ? `esforço ${ideia.esforco}` : ""]
        .filter(Boolean)
        .map((m) => `<span class="selo">${escapar(m)}</span>`)
        .join("");
      return `<label class="ideia">
        <input type="checkbox" data-indice="${indice}" checked>
        <div>
          <strong>${escapar(ideia.title)}</strong>
          <p>${escapar(ideia.description)}</p>
          <div class="selos">${marcas}${
            prazo ? `<span class="selo">prazo ${escapar(prazo)}</span>` : ""
          }</div>
        </div>
      </label>`;
    })
    .join("");
  caixa.classList.remove("oculto");
  $("ideias-acoes").classList.remove("oculto");
  msg($("criar-msg"), "");
}

async function criarCartoes() {
  const marcadas = [...document.querySelectorAll("#ideias-geradas input:checked")].map(
    (input) => ideiasGeradas[Number(input.dataset.indice)]
  );
  if (!marcadas.length) {
    msg($("criar-msg"), "Marque ao menos uma ideia.", "erro");
    return;
  }
  const botao = $("btn-criar-cartoes");
  botao.disabled = true;
  msg($("criar-msg"), "Criando no Trello…");
  try {
    const resposta = await api("/api/estudio/criar-cartoes", {
      method: "POST",
      body: JSON.stringify({ destino: $("sel-destino").value, ideias: marcadas }),
    });
    msg($("criar-msg"), `${resposta.cartoes.length} cartão(ões) criado(s).`, "ok");
    ideiasGeradas = [];
    desenharIdeias();
    carregarCards();
  } catch (erro) {
    msg($("criar-msg"), erro.message, "erro");
  } finally {
    botao.disabled = false;
  }
}

async function organizar() {
  const botao = $("btn-organizar");
  botao.disabled = true;
  msg($("organizar-msg"), "Lendo o board…");
  try {
    const analise = await api("/api/estudio/organizar", { method: "POST" });
    const bloco = (titulo, itens, render) =>
      itens && itens.length
        ? `<h3>${titulo}</h3><ul class="lista-analise">${itens.map(render).join("")}</ul>`
        : "";

    $("analise").innerHTML = `
      <p class="resumo">${escapar(analise.resumo)}</p>
      ${bloco(
        "Prioridades",
        analise.prioridades,
        (p) =>
          `<li><span class="urgencia urgencia-${escapar(p.urgencia)}">${escapar(
            p.urgencia
          )}</span><strong>${escapar(p.titulo)}</strong><span class="motivo">${escapar(
            p.motivo
          )}</span></li>`
      )}
      ${bloco(
        "Possíveis duplicatas",
        analise.duplicatas,
        (d) =>
          `<li><strong>${d.titulos.map(escapar).join(" + ")}</strong><span class="motivo">${escapar(
            d.sugestao
          )}</span></li>`
      )}
      ${bloco("Lacunas", analise.lacunas, (l) => `<li>${escapar(l)}</li>`)}
      ${bloco("Próximos passos", analise.proximos_passos, (p) => `<li>${escapar(p)}</li>`)}
    `;
    $("analise").classList.remove("oculto");
    msg($("organizar-msg"), "");
  } catch (erro) {
    msg($("organizar-msg"), erro.message, "erro");
  } finally {
    botao.disabled = false;
  }
}

/* ----------------------------------------------------------------- whatsapp */
function desenharWhatsApp(whatsapp) {
  if (!whatsapp) return;
  if (document.activeElement !== $("sel-provedor")) $("sel-provedor").value = whatsapp.provedor;
  if (!$("inp-grupos").dataset.tocado) $("inp-grupos").value = (whatsapp.grupos || []).join(", ");
  $("url-webhook").textContent = `${location.origin}/webhook/whatsapp`;
  alternarCamposWhatsApp();
}

function alternarCamposWhatsApp() {
  const provedor = $("sel-provedor").value;
  $("campo-apikey").classList.toggle("oculto", !["evolution", "generico"].includes(provedor));
  $("campo-verify").classList.toggle("oculto", provedor !== "meta");
  $("campo-secret").classList.toggle("oculto", provedor !== "meta");
}

async function salvarWhatsApp() {
  const botao = $("btn-salvar-whatsapp");
  botao.disabled = true;
  msg($("whatsapp-msg"), "Gravando no .env…");
  try {
    const corpo = { provedor: $("sel-provedor").value, grupos: $("inp-grupos").value };
    // Campos em branco preservam o valor atual — nunca apagam uma chave por engano.
    if ($("inp-apikey").value) corpo.api_key = $("inp-apikey").value;
    if ($("inp-verify").value) corpo.verify_token = $("inp-verify").value;
    if ($("inp-secret").value) corpo.app_secret = $("inp-secret").value;

    await api("/api/config/whatsapp", { method: "POST", body: JSON.stringify(corpo) });
    ["inp-apikey", "inp-verify", "inp-secret"].forEach((id) => ($(id).value = ""));
    msg($("whatsapp-msg"), "Conexão salva.", "ok");
    carregarStatus();
  } catch (erro) {
    msg($("whatsapp-msg"), erro.message, "erro");
  } finally {
    botao.disabled = false;
  }
}

function desenharRede(rede, whatsapp) {
  if (!rede) return;
  const naRede = rede.host === "0.0.0.0";
  $("rede").innerHTML = `
    <li><span>Escutando em</span><code>${escapar(rede.host)}:${escapar(rede.porta)}</code></li>
    <li><span>Alcance</span>${naRede ? "rede local" : "somente este Mac"}</li>
    <li><span>Token exigido</span>${rede.token_exigido ? "sim" : "não"}</li>
    <li><span>WhatsApp</span>${
      whatsapp && whatsapp.ativo ? escapar(whatsapp.provedor) : "desligado"
    }</li>`;
}

/* ----------------------------------------------------------------- encerrar */
async function encerrar() {
  if (!confirm("Encerrar o servidor do Cérebro?")) return;
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
$("btn-reprocessar").onclick = reprocessarFila;
$("btn-gerar").onclick = gerarIdeias;
$("btn-criar-cartoes").onclick = criarCartoes;
$("btn-organizar").onclick = organizar;
$("sel-provedor").onchange = alternarCamposWhatsApp;
$("btn-salvar-whatsapp").onclick = salvarWhatsApp;
$("inp-grupos").oninput = () => ($("inp-grupos").dataset.tocado = "1");
$("btn-copiar-webhook").onclick = () => {
  navigator.clipboard.writeText($("url-webhook").textContent).then(() => {
    $("btn-copiar-webhook").textContent = "Copiado!";
    setTimeout(() => ($("btn-copiar-webhook").textContent = "Copiar"), 2000);
  });
};
$("btn-exemplo").onclick = () => {
  $("txt-mensagem").value = EXEMPLO;
  $("inp-grupo").value = $("inp-grupo").value || "EXPANSAO OSASCO";
};
$("txt-mensagem").addEventListener("keydown", (evento) => {
  if ((evento.metaKey || evento.ctrlKey) && evento.key === "Enter") processar();
});
$("inp-tema").addEventListener("keydown", (evento) => {
  if (evento.key === "Enter") gerarIdeias();
});

carregarStatus();
carregarHistorico();
setInterval(() => {
  carregarStatus();
  carregarHistorico();
}, 20000);
