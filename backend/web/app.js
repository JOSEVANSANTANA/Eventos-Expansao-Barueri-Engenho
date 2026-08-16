/* Painel do Cérebro de Operações — sem dependências externas. */

const $ = (id) => document.getElementById(id);

const EXEMPLO =
  "Pessoal, foi confirmado que haverá ceia na Estadual neste domingo, vamos gravar " +
  "vídeos ao final do culto para divulgar a Vigília. Lívia já mandou as referências, " +
  "Letícia vai fazer o roteiro hoje.";

let estado = { areas: [], areaAtiva: null, boards: [], ideiasGeradas: [], editandoArea: null };

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

/** Área ativa do painel — usada por Operação e Estúdio. */
function areaAtiva() {
  return estado.areas.find((a) => a.id === estado.areaAtiva) || null;
}

function comArea(corpo = {}) {
  return estado.areaAtiva ? { ...corpo, area_id: estado.areaAtiva } : corpo;
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

function irPara(alvo) {
  const aba = [...document.querySelectorAll(".aba")].find((a) => a.dataset.alvo === alvo);
  if (aba) aba.click();
}

/* ------------------------------------------------------------------- status */
async function carregarStatus() {
  const pill = $("pill-status");
  try {
    const status = await api("/api/status");
    estado.areas = status.areas || [];
    $("env-path").textContent = status.env_path;
    $("rodape").textContent = `v${status.version} · modelo ${status.model || "?"}`;
    desenharFila(status.fila);
    desenharChaves(status.chaves);
    desenharWhatsApp(status.whatsapp);
    desenharRede(status.rede, status.whatsapp);
    desenharSeletorArea(status.area_padrao);
    desenharAreas();

    if (status.config_error) {
      pill.textContent = "configuração incompleta";
      pill.className = "pill pill-erro";
      mostrarAlerta("Falta preencher o .env", status.config_error, null);
      return;
    }
    if (!status.chaves.gemini || !status.chaves.trello) {
      pill.textContent = "faltam chaves";
      pill.className = "pill pill-erro";
      mostrarAlerta(
        "Faltam chaves de API",
        "Preencha a chave do Gemini e as do Trello para o Cérebro funcionar.",
        { texto: "Ir para Conexões", alvo: "painel-conexoes" }
      );
      return;
    }
    if (!estado.areas.length) {
      pill.textContent = "sem áreas";
      pill.className = "pill pill-aviso";
      mostrarAlerta(
        "Nenhuma área de trabalho",
        "Crie a primeira área para dizer ao Cérebro em qual board criar os cartões.",
        { texto: "Criar área", alvo: "painel-areas" }
      );
      return;
    }

    const ativa = areaAtiva();
    if (ativa && !ativa.pronta) {
      pill.textContent = `${ativa.nome} — sem colunas`;
      pill.className = "pill pill-aviso";
      mostrarAlerta(
        `A área ${ativa.nome} está incompleta`,
        "Escolha as colunas de Ideias e Tarefas para ela.",
        { texto: "Configurar", alvo: "painel-areas" }
      );
      return;
    }

    esconderAlerta();
    pill.textContent = ativa ? `pronto — ${ativa.nome}` : "pronto";
    pill.className = "pill pill-ok";
    carregarCards();
  } catch (erro) {
    pill.textContent = erro.message.includes("Token") ? "sem autorização" : "servidor fora do ar";
    pill.className = "pill pill-erro";
    mostrarAlerta("Não consegui falar com o servidor", erro.message, null);
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

function desenharChaves(chaves) {
  if (!chaves) return;
  const marcar = (id, tem) => {
    const elemento = $(id);
    elemento.textContent = tem ? "· configurada" : "· faltando";
    elemento.className = "marcador " + (tem ? "marcador-ok" : "marcador-falta");
  };
  marcar("tem-gemini", chaves.gemini);
  marcar("tem-trello", chaves.trello);
  marcar("tem-secret", chaves.trello_secret);
}

function mostrarAlerta(titulo, texto, acao) {
  $("alerta-titulo").textContent = titulo;
  $("alerta-texto").textContent = texto;
  const botao = $("btn-alerta-acao");
  if (acao) {
    botao.textContent = acao.texto;
    botao.onclick = () => irPara(acao.alvo);
    botao.classList.remove("oculto");
  } else {
    botao.classList.add("oculto");
  }
  $("alerta").classList.remove("oculto");
}

function esconderAlerta() {
  $("alerta").classList.add("oculto");
}

/* ------------------------------------------------------- seletor de área */
function desenharSeletorArea(padraoDoServidor) {
  const sel = $("sel-area-ativa");
  const guardada = Number(localStorage.getItem("cerebro_area") || 0);
  const ids = estado.areas.map((a) => a.id);

  if (!ids.includes(estado.areaAtiva)) {
    estado.areaAtiva = ids.includes(guardada) ? guardada : padraoDoServidor || ids[0] || null;
  }

  sel.innerHTML = estado.areas.length
    ? estado.areas
        .map(
          (a) =>
            `<option value="${a.id}" ${a.id === estado.areaAtiva ? "selected" : ""}>${escapar(
              a.nome
            )}${a.padrao ? " ★" : ""}</option>`
        )
        .join("")
    : '<option value="">nenhuma área</option>';

  const nome = areaAtiva() ? areaAtiva().nome : "";
  ["area-operacao", "area-board", "area-estudio", "area-organizar"].forEach((id) => {
    const chip = $(id);
    chip.textContent = nome;
    chip.classList.toggle("oculto", !nome);
  });
}

$("sel-area-ativa").onchange = () => {
  estado.areaAtiva = Number($("sel-area-ativa").value) || null;
  localStorage.setItem("cerebro_area", String(estado.areaAtiva || ""));
  desenharSeletorArea();
  esconderAlerta();
  carregarCards();
  carregarStatus();
};

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
      body: JSON.stringify(
        comArea({
          text: texto,
          sender: $("inp-autor").value.trim() || null,
          group: $("inp-grupo").value.trim() || null,
        })
      ),
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
  const area = resultado.area ? `<span class="chip-area">${escapar(resultado.area)}</span>` : "";

  if (resultado.status !== "created") {
    caixa.innerHTML = `${etiqueta}${area}<h3>Nada foi criado</h3>
      <p>${escapar(resultado.detail || "Mensagem classificada como bate-papo.")}</p>`;
  } else {
    const prazo = formatarPrazo(resultado.due_date);
    caixa.innerHTML = `${etiqueta}${area}<h3>${escapar(resultado.title)}</h3>
      ${prazo ? `<p>Prazo: ${escapar(prazo)}</p>` : ""}
      <p><a href="${escapar(resultado.card_url)}" target="_blank" rel="noopener">Abrir cartão no Trello →</a></p>`;
  }
  caixa.classList.remove("oculto");
}

/* --------------------------------------------------------------- board vivo */
async function carregarCards() {
  const ativa = areaAtiva();
  if (!ativa || !ativa.pronta) {
    desenharCards("lista-ideias", "cont-ideias", []);
    desenharCards("lista-tarefas", "cont-tarefas", []);
    return;
  }
  const botao = $("btn-cards");
  botao.disabled = true;
  try {
    const dados = await api(`/api/cards?area_id=${ativa.id}`);
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
  comando: () => '<span class="etiqueta etiqueta-comando">comando</span>',
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
        const origem = `<span class="origem">${escapar(item.origem || "painel")}</span>`;
        const area = item.area_nome
          ? `<span class="chip-area">${escapar(item.area_nome)}</span>`
          : "";
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
            ${etiqueta}${origem}${area}
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
      body: JSON.stringify(
        comArea({
          tema,
          quantidade: Number($("sel-quantidade").value),
          usar_board: $("chk-board").checked,
        })
      ),
    });
    estado.ideiasGeradas = resposta.ideias || [];
    desenharIdeias();
    msg($("estudio-msg"), `${estado.ideiasGeradas.length} ideia(s) para ${resposta.area}.`, "ok");
  } catch (erro) {
    msg($("estudio-msg"), erro.message, "erro");
  } finally {
    botao.disabled = false;
  }
}

function desenharIdeias() {
  const caixa = $("ideias-geradas");
  if (!estado.ideiasGeradas.length) {
    caixa.classList.add("oculto");
    $("ideias-acoes").classList.add("oculto");
    return;
  }
  caixa.innerHTML = estado.ideiasGeradas
    .map((ideia, indice) => {
      const prazo = formatarPrazo(ideia.due_date);
      const selos = [ideia.formato, ideia.esforco ? `esforço ${ideia.esforco}` : ""]
        .filter(Boolean)
        .map((m) => `<span class="selo">${escapar(m)}</span>`)
        .join("");
      return `<label class="ideia">
        <input type="checkbox" data-indice="${indice}" checked>
        <div>
          <strong>${escapar(ideia.title)}</strong>
          <p>${escapar(ideia.description)}</p>
          <div class="selos">${selos}${
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
    (input) => estado.ideiasGeradas[Number(input.dataset.indice)]
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
      body: JSON.stringify(comArea({ destino: $("sel-destino").value, ideias: marcadas })),
    });
    msg($("criar-msg"), `${resposta.cartoes.length} cartão(ões) em ${resposta.area}.`, "ok");
    estado.ideiasGeradas = [];
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
    const analise = await api("/api/estudio/organizar", {
      method: "POST",
      body: JSON.stringify(comArea()),
    });
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

/* -------------------------------------------------------------------- áreas */
function limparFormularioArea() {
  estado.editandoArea = null;
  estado.boards = [];
  ["inp-area-nome", "inp-area-key", "inp-area-token", "inp-area-secret"].forEach(
    (id) => ($(id).value = "")
  );
  $("sel-board").innerHTML = '<option value="">— carregue os boards —</option>';
  ["sel-ideias", "sel-tarefas"].forEach((id) => {
    $(id).innerHTML = '<option value="">—</option>';
    $(id).disabled = true;
  });
  $("form-area-titulo").textContent = "Nova área de trabalho";
  $("btn-cancelar-area").classList.add("oculto");
  msg($("area-msg"), "");
  msg($("boards-msg"), "");
}

function editarArea(id) {
  const area = estado.areas.find((a) => a.id === id);
  if (!area) return;
  estado.editandoArea = id;
  $("inp-area-nome").value = area.nome;
  ["inp-area-key", "inp-area-token", "inp-area-secret"].forEach(($id) => ($($id).value = ""));
  $("inp-area-key").placeholder = area.credencial_propria
    ? "chave própria guardada — em branco mantém"
    : "usa a chave global se vazio";
  $("form-area-titulo").textContent = `Editando: ${area.nome}`;
  $("btn-cancelar-area").classList.remove("oculto");
  $("sel-board").innerHTML = `<option value="">${
    area.board_nome ? escapar(area.board_nome) : "— carregue os boards —"
  }</option>`;
  $("sel-ideias").innerHTML = `<option value="${escapar(area.list_ideias)}">${escapar(
    area.list_ideias_nome || area.list_ideias || "—"
  )}</option>`;
  $("sel-tarefas").innerHTML = `<option value="${escapar(area.list_tarefas)}">${escapar(
    area.list_tarefas_nome || area.list_tarefas || "—"
  )}</option>`;
  irPara("painel-areas");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function carregarBoards() {
  const botao = $("btn-carregar-boards");
  botao.disabled = true;
  msg($("boards-msg"), "Buscando boards no Trello…");
  try {
    estado.boards = await api("/api/trello/boards", {
      method: "POST",
      body: JSON.stringify({
        trello_key: $("inp-area-key").value.trim(),
        trello_token: $("inp-area-token").value.trim(),
        area_id: estado.editandoArea,
      }),
    });
    const sel = $("sel-board");
    sel.innerHTML = '<option value="">— escolha o board —</option>';
    estado.boards.forEach((board, indice) => {
      const opcao = document.createElement("option");
      opcao.value = String(indice);
      opcao.textContent = board.name;
      sel.appendChild(opcao);
    });
    const nome = $("inp-area-nome").value.trim();
    const parecido = nome
      ? estado.boards.findIndex((b) =>
          b.name.toLowerCase().includes(nome.toLowerCase().slice(0, 6))
        )
      : -1;
    if (parecido >= 0) {
      sel.value = String(parecido);
      preencherListas();
    }
    msg($("boards-msg"), `${estado.boards.length} board(s) encontrados.`, "ok");
  } catch (erro) {
    msg($("boards-msg"), erro.message, "erro");
  } finally {
    botao.disabled = false;
  }
}

function preencherListas() {
  const indice = $("sel-board").value;
  const listas = indice === "" ? [] : estado.boards[Number(indice)].lists;
  [$("sel-ideias"), $("sel-tarefas")].forEach((sel) => {
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
  $("sel-ideias").value = acha(/ideia|refer|inspira|banco|backlog/i);
  $("sel-tarefas").value = acha(/tarefa|fazer|todo|produ|execu/i);
}

function nomeDaOpcao(sel) {
  const opcao = sel.selectedOptions && sel.selectedOptions[0];
  return opcao && opcao.value ? opcao.textContent : "";
}

async function salvarArea() {
  const nome = $("inp-area-nome").value.trim();
  if (nome.length < 2) {
    msg($("area-msg"), "Dê um nome à área.", "erro");
    return;
  }
  const ideias = $("sel-ideias").value;
  const tarefas = $("sel-tarefas").value;
  if (ideias && ideias === tarefas) {
    msg($("area-msg"), "As duas colunas precisam ser diferentes.", "erro");
    return;
  }

  const indiceBoard = $("sel-board").value;
  const board = indiceBoard === "" ? null : estado.boards[Number(indiceBoard)];
  const corpo = {
    nome,
    list_ideias: ideias,
    list_ideias_nome: nomeDaOpcao($("sel-ideias")),
    list_tarefas: tarefas,
    list_tarefas_nome: nomeDaOpcao($("sel-tarefas")),
  };
  if (board) {
    corpo.board_id = board.id;
    corpo.board_nome = board.name;
  }
  // Campos de credencial em branco não sobrescrevem o que já está guardado.
  ["key", "token", "secret"].forEach((campo) => {
    const valor = $(`inp-area-${campo}`).value.trim();
    if (valor) corpo[`trello_${campo}`] = valor;
  });

  const botao = $("btn-salvar-area");
  botao.disabled = true;
  msg($("area-msg"), "Salvando…");
  try {
    if (estado.editandoArea) {
      await api(`/api/areas/${estado.editandoArea}`, {
        method: "PATCH",
        body: JSON.stringify(corpo),
      });
    } else {
      const criada = await api("/api/areas", { method: "POST", body: JSON.stringify(corpo) });
      estado.areaAtiva = criada.id;
      localStorage.setItem("cerebro_area", String(criada.id));
    }
    limparFormularioArea();
    msg($("area-msg"), "Área salva.", "ok");
    await carregarStatus();
  } catch (erro) {
    msg($("area-msg"), erro.message, "erro");
  } finally {
    botao.disabled = false;
  }
}

function desenharAreas() {
  const caixa = $("lista-areas");
  if (!estado.areas.length) {
    caixa.innerHTML = '<p class="vazio-bloco">Nenhuma área ainda. Crie a primeira acima.</p>';
    return;
  }
  caixa.innerHTML = estado.areas
    .map((area) => {
      const chips = (area.vinculos || [])
        .map(
          (v) =>
            `<span class="vinculo ${v.tipo === "contato" ? "vinculo-contato" : ""}">
               ${escapar(v.identificador)}
               <button class="x" data-vinculo="${v.id}" title="Remover">×</button>
             </span>`
        )
        .join("");
      const colunas = area.pronta
        ? `${escapar(area.list_ideias_nome || "ideias")} · ${escapar(
            area.list_tarefas_nome || "tarefas"
          )}`
        : "colunas não escolhidas";
      return `<div class="area-cartao ${area.pronta ? "" : "area-incompleta"}">
        <div class="area-topo">
          <div>
            <strong>${escapar(area.nome)}</strong>
            ${area.padrao ? '<span class="selo selo-padrao">padrão</span>' : ""}
            ${area.credencial_propria ? '<span class="selo">chave própria</span>' : ""}
            <div class="area-sub">${escapar(area.board_nome || "board não escolhido")} · ${colunas}</div>
          </div>
          <div class="grupo-botoes">
            ${area.padrao ? "" : `<button class="btn btn-fantasma" data-padrao="${area.id}">Tornar padrão</button>`}
            <button class="btn btn-fantasma" data-editar="${area.id}">Editar</button>
            <button class="btn btn-perigo" data-remover="${area.id}">Remover</button>
          </div>
        </div>
        <div class="area-vinculos">
          <span class="rotulo">Grupos e contatos ligados:</span>
          ${chips || '<span class="nenhum">nenhum ainda</span>'}
        </div>
        <div class="linha-vincular">
          <input type="text" data-nome-vinculo="${area.id}" placeholder="Nome do grupo ou contato no WhatsApp">
          <select data-tipo-vinculo="${area.id}">
            <option value="grupo">grupo</option>
            <option value="contato">contato</option>
          </select>
          <button class="btn btn-fantasma" data-vincular="${area.id}">Ligar</button>
        </div>
      </div>`;
    })
    .join("");

  caixa.querySelectorAll("[data-editar]").forEach((b) => {
    b.onclick = () => editarArea(Number(b.dataset.editar));
  });
  caixa.querySelectorAll("[data-padrao]").forEach((b) => {
    b.onclick = async () => {
      await api(`/api/areas/${b.dataset.padrao}/padrao`, { method: "POST" }).catch(() => {});
      carregarStatus();
    };
  });
  caixa.querySelectorAll("[data-remover]").forEach((b) => {
    b.onclick = async () => {
      const area = estado.areas.find((a) => a.id === Number(b.dataset.remover));
      if (!confirm(`Remover a área "${area.nome}"? Os vínculos dela também somem.`)) return;
      await api(`/api/areas/${b.dataset.remover}`, { method: "DELETE" }).catch((e) =>
        alert(e.message)
      );
      carregarStatus();
    };
  });
  caixa.querySelectorAll("[data-vinculo]").forEach((b) => {
    b.onclick = async () => {
      await api(`/api/vinculos/${b.dataset.vinculo}`, { method: "DELETE" }).catch(() => {});
      carregarStatus();
    };
  });
  caixa.querySelectorAll("[data-vincular]").forEach((b) => {
    b.onclick = async () => {
      const id = b.dataset.vincular;
      const campo = caixa.querySelector(`[data-nome-vinculo="${id}"]`);
      const tipo = caixa.querySelector(`[data-tipo-vinculo="${id}"]`).value;
      const identificador = campo.value.trim();
      if (identificador.length < 2) return;
      try {
        await api(`/api/areas/${id}/vinculos`, {
          method: "POST",
          body: JSON.stringify({ identificador, tipo }),
        });
        campo.value = "";
        carregarStatus();
      } catch (erro) {
        alert(erro.message);
      }
    };
  });
}

/* ------------------------------------------------------------------ chaves */
async function salvarChaves() {
  const corpo = {};
  const campos = {
    "inp-gemini": "gemini_api_key",
    "inp-modelo": "gemini_model",
    "inp-trello-key": "trello_api_key",
    "inp-trello-token": "trello_token",
    "inp-trello-secret": "trello_secret",
  };
  Object.entries(campos).forEach(([id, chave]) => {
    const valor = $(id).value.trim();
    if (valor) corpo[chave] = valor;
  });
  if (!Object.keys(corpo).length) {
    msg($("chaves-msg"), "Preencha ao menos um campo.", "erro");
    return;
  }

  const botao = $("btn-salvar-chaves");
  botao.disabled = true;
  msg($("chaves-msg"), "Gravando no .env…");
  try {
    await api("/api/config/chaves", { method: "POST", body: JSON.stringify(corpo) });
    Object.keys(campos).forEach((id) => ($(id).value = ""));
    msg($("chaves-msg"), "Chaves salvas.", "ok");
    carregarStatus();
  } catch (erro) {
    msg($("chaves-msg"), erro.message, "erro");
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
    }</li>
    <li><span>Áreas cadastradas</span>${estado.areas.length}</li>`;
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
$("btn-processar").onclick = processar;
$("btn-cards").onclick = carregarCards;
$("btn-limpar-historico").onclick = limparHistorico;
$("btn-reprocessar").onclick = reprocessarFila;
$("btn-gerar").onclick = gerarIdeias;
$("btn-criar-cartoes").onclick = criarCartoes;
$("btn-organizar").onclick = organizar;
$("btn-carregar-boards").onclick = carregarBoards;
$("sel-board").onchange = preencherListas;
$("btn-salvar-area").onclick = salvarArea;
$("btn-cancelar-area").onclick = limparFormularioArea;
$("btn-salvar-chaves").onclick = salvarChaves;
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
  const ativa = areaAtiva();
  $("inp-grupo").value = $("inp-grupo").value || (ativa ? ativa.nome : "");
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
