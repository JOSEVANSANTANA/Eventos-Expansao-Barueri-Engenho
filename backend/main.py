"""Cérebro de Operações — API FastAPI + painel web.

Sobe com:
    uvicorn main:app --reload          (local)
    python main.py                     (usa HOST/PORT do .env)
No Mac, o duplo clique em `Cerebro.command` faz isso e abre o Chrome no painel;
`Cerebro Servidor.command` sobe para a rede local.
"""

from __future__ import annotations

import asyncio
import ipaddress
import os
import signal
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, Depends, FastAPI, Request, Response, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from cerebro import __version__
from cerebro.config import (
    ENV_PATH,
    ConfigError,
    Settings,
    get_settings,
    reload_settings,
    write_env_values,
)
from cerebro.console import banner, log, red, yellow
from cerebro.db import Store
from cerebro.estudio import EstudioCriativo, Ideia
from cerebro.gemini import GeminiAnalysisError
from cerebro.models import WebhookMessage, WebhookResponse
from cerebro.pipeline import Pipeline, build_pipeline
from cerebro.trello import TrelloClient, TrelloError
from cerebro.whatsapp import (
    WhatsAppError,
    traduzir,
    verificar_apikey_evolution,
    verificar_assinatura_meta,
)

WEB_DIR = Path(__file__).resolve().parent / "web"

# Rotas que nunca exigem o token de rede: têm autenticação própria ou são públicas.
# A raiz é comparada por igualdade — como prefixo, "/" liberaria o site inteiro.
ROTAS_LIVRES = ("/health", "/webhook/whatsapp", "/static", "/favicon.ico")


class NotConfiguredError(RuntimeError):
    """O app subiu, mas falta configuração para executar esta ação."""


# --------------------------------------------------------------------- ciclo de vida
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Sobe sempre — mesmo sem configuração — para o painel poder guiar o setup."""
    app.state.pipeline = None
    app.state.settings = None
    app.state.config_error = None
    app.state.store = None
    app.state.estudio = None
    app.state.fila_tarefa = None

    try:
        settings: Settings | None = get_settings()
        app.state.settings = settings
    except ConfigError as exc:
        app.state.config_error = str(exc)
        log.error("%s %s", red("Configuração incompleta:"), exc)
        log.warning("O painel abriu mesmo assim — termine a configuração por lá.")
        settings = None

    if settings:
        app.state.store = Store(settings.db_path, timezone=settings.timezone)
        banner(settings.host, settings.port, settings.gemini_model)
        if settings.trello_list_id_ideias and settings.trello_list_id_tarefas:
            log.info("Lista de IDEIAS  → %s", settings.trello_list_id_ideias)
            log.info("Lista de TAREFAS → %s", settings.trello_list_id_tarefas)
        else:
            log.warning("%s", yellow("Faltam os IDs das listas — escolha-os no painel."))
        if settings.whatsapp_ativo:
            log.info("WhatsApp: provedor %s", settings.whatsapp_provider)
        pendentes = app.state.store.estatisticas()["pendentes"]
        if pendentes:
            log.warning("%s", yellow(f"{pendentes} mensagem(ns) na fila — vou reprocessar."))
        app.state.fila_tarefa = asyncio.create_task(_worker_fila(app))
        log.info("Pronto. Aguardando mensagens…")

    yield

    tarefa = getattr(app.state, "fila_tarefa", None)
    if tarefa:
        tarefa.cancel()
        try:
            await tarefa
        except asyncio.CancelledError:
            pass
    if getattr(app.state, "store", None):
        app.state.store.close()
    log.info("Cérebro encerrado.")


async def _worker_fila(app: FastAPI) -> None:
    """Reprocessa em segundo plano o que ficou pendente (queda de rede, API fora)."""
    while True:
        settings: Settings | None = getattr(app.state, "settings", None)
        intervalo = settings.fila_intervalo if settings else 20.0
        try:
            await asyncio.sleep(intervalo)
            store: Store | None = getattr(app.state, "store", None)
            if store is None or settings is None:
                continue
            if not (settings.trello_list_id_ideias and settings.trello_list_id_tarefas):
                continue
            vencidas = await run_in_threadpool(store.pendentes_vencidas, 5)
            if not vencidas:
                continue
            log.info("Fila: reprocessando %s mensagem(ns)…", len(vencidas))
            pipeline = _montar_pipeline(app, settings)
            for linha in vencidas:
                await run_in_threadpool(_processar_linha, pipeline, store, linha)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 — o worker nunca pode morrer
            log.error("Fila: erro inesperado no worker: %s", exc)


def _processar_linha(pipeline: Pipeline, store: Store, linha: dict[str, Any]) -> None:
    """Executa uma mensagem já gravada e atualiza o seu estado na fila."""
    mensagem = WebhookMessage(
        text=linha["texto"], sender=linha.get("autor"), group=linha.get("grupo")
    )
    try:
        resposta = pipeline.process(mensagem)
    except (GeminiAnalysisError, TrelloError) as exc:
        estagio = "gemini" if isinstance(exc, GeminiAnalysisError) else "trello"
        # Credencial errada não melhora com repetição; rede e cota, sim.
        permanente = any(
            marca in str(exc).lower()
            for marca in ("api key", "401", "unauthorized", "not found", "404")
        )
        store.marcar_falha(linha["id"], estagio, str(exc), reagendar=not permanente)
        return
    except ValueError as exc:
        store.marcar_falha(linha["id"], "config", str(exc), reagendar=True)
        return
    store.marcar_sucesso(linha["id"], resposta)


app = FastAPI(
    title="Cérebro de Operações",
    description="Recebe mensagens do grupo, classifica com Gemini e cria cartões no Trello.",
    version=__version__,
    lifespan=lifespan,
)

if WEB_DIR.is_dir():
    app.mount("/static", StaticFiles(directory=str(WEB_DIR)), name="static")


# ------------------------------------------------------------------- autenticação
@app.middleware("http")
async def exigir_token(request: Request, call_next):
    """Com SERVER_TOKEN definido, acessos de fora da máquina precisam do token.

    Quem está no próprio Mac (127.0.0.1) nunca é barrado — o painel local
    continua abrindo com um clique.
    """
    settings: Settings | None = getattr(request.app.state, "settings", None)
    token = settings.server_token if settings else ""
    caminho = request.url.path

    livre = caminho == "/" or caminho.startswith(ROTAS_LIVRES)
    if token and not livre:
        cliente = request.client.host if request.client else ""
        if not _e_local(cliente):
            enviado = request.headers.get("x-cerebro-token") or request.query_params.get("token")
            if not enviado or enviado != token:
                return JSONResponse(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    content={
                        "status": "error",
                        "stage": "auth",
                        "detail": "Token ausente ou inválido (cabeçalho X-Cerebro-Token).",
                    },
                )
    return await call_next(request)


def _e_local(host: str) -> bool:
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return host in ("localhost", "")


# ------------------------------------------------------------------------ helpers
def current_settings(request: Request) -> Settings:
    settings: Settings | None = getattr(request.app.state, "settings", None)
    if settings is None:
        raise NotConfiguredError(
            getattr(request.app.state, "config_error", None)
            or "Configuração ausente. Preencha o .env."
        )
    return settings


def trello_client(request: Request) -> TrelloClient:
    settings = current_settings(request)
    return TrelloClient(
        settings.trello_api_key, settings.trello_token, timeout=settings.request_timeout
    )


def _montar_pipeline(app: FastAPI, settings: Settings) -> Pipeline:
    pipeline: Pipeline | None = getattr(app.state, "pipeline", None)
    if pipeline is None or pipeline.settings != settings:
        pipeline = build_pipeline(settings)
        app.state.pipeline = pipeline
    return pipeline


def get_pipeline(request: Request) -> Pipeline:
    """Pipeline montado sob demanda (e recriado quando a configuração muda)."""
    settings = current_settings(request)
    if not (settings.trello_list_id_ideias and settings.trello_list_id_tarefas):
        raise NotConfiguredError(
            "Escolha as listas do Trello para IDEIAS e TAREFAS antes de processar mensagens."
        )
    return _montar_pipeline(request.app, settings)


def get_pipeline_opcional(request: Request) -> Pipeline | None:
    """Igual ao anterior, mas devolve None em vez de erro quando falta configuração.

    O webhook do WhatsApp usa esta versão: mensagem que chega antes de o Trello
    estar pronto vai para a fila em vez de ser recusada.
    """
    try:
        return get_pipeline(request)
    except NotConfiguredError:
        return None


def get_store(request: Request) -> Store:
    store: Store | None = getattr(request.app.state, "store", None)
    if store is None:
        settings = current_settings(request)
        store = Store(settings.db_path, timezone=settings.timezone)
        request.app.state.store = store
    return store


def get_estudio(request: Request) -> EstudioCriativo:
    settings = current_settings(request)
    estudio: EstudioCriativo | None = getattr(request.app.state, "estudio", None)
    if estudio is None:
        estudio = EstudioCriativo(settings)
        request.app.state.estudio = estudio
    return estudio


def _processar_e_registrar(
    pipeline: Pipeline, store: Store, mensagem: WebhookMessage, *, origem: str,
    external_id: str | None = None,
) -> WebhookResponse:
    """Grava, processa e atualiza o estado — o caminho único de toda mensagem."""
    mensagem_id = store.registrar(
        mensagem.text,
        autor=mensagem.sender,
        grupo=mensagem.group,
        origem=origem,
        external_id=external_id,
    )
    if mensagem_id is None:  # duplicata do WhatsApp: já vimos essa mensagem
        return WebhookResponse(
            status="duplicate",
            action_type="ignorar",
            detail="Mensagem já recebida anteriormente.",
        )
    try:
        resposta = pipeline.process(mensagem)
    except (GeminiAnalysisError, TrelloError) as exc:
        estagio = "gemini" if isinstance(exc, GeminiAnalysisError) else "trello"
        store.marcar_falha(mensagem_id, estagio, str(exc))
        raise
    store.marcar_sucesso(mensagem_id, resposta)
    return resposta


# --------------------------------------------------------------------- painel web
@app.get("/", include_in_schema=False)
def painel():
    index = WEB_DIR / "index.html"
    if index.is_file():
        return FileResponse(index)
    return JSONResponse({"service": "cerebro-de-operacoes", "version": __version__})


@app.get("/api/info", include_in_schema=False)
def info() -> dict[str, str]:
    return {"service": "cerebro-de-operacoes", "version": __version__, "docs": "/docs"}


@app.get("/health")
def health(request: Request) -> dict[str, object]:
    settings: Settings | None = getattr(request.app.state, "settings", None)
    return {
        "status": "ok",
        "version": __version__,
        "model": settings.gemini_model if settings else None,
        "lists": {
            "ideias": bool(settings and settings.trello_list_id_ideias),
            "tarefas": bool(settings and settings.trello_list_id_tarefas),
        },
    }


@app.get("/api/status")
def api_status(request: Request) -> dict[str, Any]:
    """Tudo que o painel precisa para decidir entre 'operar' e 'configurar'."""
    settings: Settings | None = getattr(request.app.state, "settings", None)
    store: Store | None = getattr(request.app.state, "store", None)
    resultado: dict[str, Any] = {
        "version": __version__,
        "env_path": str(ENV_PATH),
        "config_error": getattr(request.app.state, "config_error", None),
        "model": settings.gemini_model if settings else None,
        "timezone": settings.timezone if settings else None,
        "ready": False,
        "trello_user": None,
        "lists": {"ideias": None, "tarefas": None},
        "fila": store.estatisticas() if store else None,
        "whatsapp": {
            "ativo": bool(settings and settings.whatsapp_ativo),
            "provedor": settings.whatsapp_provider if settings else "nenhum",
            "grupos": list(settings.whatsapp_grupos) if settings else [],
        },
        "rede": {
            "host": settings.host if settings else None,
            "porta": settings.port if settings else None,
            "token_exigido": bool(settings and settings.server_token),
        },
    }
    if settings is None:
        return resultado

    resultado["lists"] = {
        "ideias": {"id": settings.trello_list_id_ideias or None, "name": None},
        "tarefas": {"id": settings.trello_list_id_tarefas or None, "name": None},
    }
    resultado["ready"] = bool(settings.trello_list_id_ideias and settings.trello_list_id_tarefas)

    client = TrelloClient(
        settings.trello_api_key, settings.trello_token, timeout=settings.request_timeout
    )
    try:
        eu = client.me()
        resultado["trello_user"] = eu.get("fullName") or eu.get("username")
    except TrelloError as exc:
        resultado["trello_error"] = str(exc)
        return resultado

    for chave in ("ideias", "tarefas"):
        list_id = resultado["lists"][chave]["id"]
        if not list_id:
            continue
        try:
            resultado["lists"][chave]["name"] = client.get_list(list_id).get("name")
        except TrelloError as exc:
            resultado["lists"][chave]["error"] = str(exc)
            resultado["ready"] = False
    return resultado


@app.get("/api/boards")
def api_boards(client: TrelloClient = Depends(trello_client)) -> list[dict[str, Any]]:
    """Boards abertos com suas listas — alimenta os seletores do painel."""
    return [
        {
            "id": board["id"],
            "name": board.get("name", "sem nome"),
            "url": board.get("url"),
            "lists": [
                {"id": lista["id"], "name": lista.get("name", "sem nome")}
                for lista in client.list_lists(board["id"])
            ],
        }
        for board in client.list_boards()
    ]


class ListsConfig(BaseModel):
    ideias: str = Field(min_length=8, max_length=64)
    tarefas: str = Field(min_length=8, max_length=64)


@app.post("/api/config/lists")
def api_salvar_listas(config: ListsConfig, request: Request) -> dict[str, Any]:
    """Grava os IDs escolhidos no .env e recarrega a configuração em memória."""
    write_env_values(
        {
            "TRELLO_LIST_ID_IDEIAS": config.ideias.strip(),
            "TRELLO_LIST_ID_TAREFAS": config.tarefas.strip(),
        }
    )
    try:
        settings = reload_settings()
    except ConfigError as exc:
        request.app.state.config_error = str(exc)
        raise NotConfiguredError(str(exc)) from exc

    request.app.state.settings = settings
    request.app.state.config_error = None
    request.app.state.pipeline = None
    request.app.state.estudio = None
    log.info("Listas atualizadas: IDEIAS=%s · TAREFAS=%s", config.ideias, config.tarefas)
    return {"status": "saved", "env_path": str(ENV_PATH)}


class WhatsAppConfig(BaseModel):
    provedor: str = Field(pattern="^(nenhum|evolution|meta|generico)$")
    grupos: str = ""
    api_key: str | None = None
    verify_token: str | None = None
    app_secret: str | None = None


@app.post("/api/config/whatsapp")
def api_salvar_whatsapp(config: WhatsAppConfig, request: Request) -> dict[str, Any]:
    """Grava a configuração do WhatsApp no .env (campos em branco não são tocados)."""
    valores = {
        "WHATSAPP_PROVIDER": config.provedor,
        "WHATSAPP_GRUPOS": config.grupos.strip(),
    }
    if config.api_key is not None:
        valores["WHATSAPP_API_KEY"] = config.api_key.strip()
    if config.verify_token is not None:
        valores["WHATSAPP_VERIFY_TOKEN"] = config.verify_token.strip()
    if config.app_secret is not None:
        valores["WHATSAPP_APP_SECRET"] = config.app_secret.strip()
    write_env_values(valores)

    settings = reload_settings()
    request.app.state.settings = settings
    log.info("WhatsApp configurado: provedor %s", config.provedor)
    return {"status": "saved", "provedor": config.provedor}


@app.get("/api/cards")
def api_cards(
    request: Request, limite: int = 12, client: TrelloClient = Depends(trello_client)
) -> dict[str, Any]:
    """Últimos cartões das duas colunas, para acompanhar o board sem sair do painel."""
    settings = current_settings(request)
    saida: dict[str, Any] = {}
    for chave, list_id in (
        ("ideias", settings.trello_list_id_ideias),
        ("tarefas", settings.trello_list_id_tarefas),
    ):
        if not list_id:
            saida[chave] = []
            continue
        saida[chave] = [
            {
                "id": card["id"],
                "name": card.get("name"),
                "due": card.get("due"),
                "url": card.get("shortUrl"),
                "updated": card.get("dateLastActivity"),
            }
            for card in client.list_cards(list_id, limit=max(1, min(limite, 50)))
        ]
    return saida


@app.get("/api/history")
def api_history(store: Store = Depends(get_store), limite: int = 60) -> list[dict[str, Any]]:
    return store.historico(limite=max(1, min(limite, 200)))


@app.delete("/api/history")
def api_limpar_history(store: Store = Depends(get_store)) -> dict[str, Any]:
    """Limpa o histórico preservando o que ainda está na fila para reprocessar."""
    return {"status": "cleared", "removidos": store.limpar(apenas_concluidas=True)}


@app.post("/api/fila/reprocessar")
def api_reprocessar(store: Store = Depends(get_store)) -> dict[str, Any]:
    """Devolve para a fila as mensagens que desistiram depois de muitas tentativas."""
    return {"status": "requeued", "mensagens": store.reenfileirar_erros()}


@app.post("/api/shutdown")
def api_shutdown(background: BackgroundTasks) -> dict[str, str]:
    """Botão 'Encerrar' do painel — derruba o servidor local."""
    log.info("Encerrando a pedido do painel…")
    background.add_task(_encerrar)
    return {"status": "stopping"}


def _encerrar() -> None:
    threading.Timer(0.4, lambda: os.kill(os.getpid(), signal.SIGTERM)).start()


# ------------------------------------------------------------------ estúdio criativo
class PedidoIdeias(BaseModel):
    tema: str = Field(min_length=3, max_length=500)
    quantidade: int = Field(default=5, ge=1, le=10)
    usar_board: bool = True


@app.post("/api/estudio/ideias")
def api_gerar_ideias(
    pedido: PedidoIdeias,
    request: Request,
    client: TrelloClient = Depends(trello_client),
    estudio: EstudioCriativo = Depends(get_estudio),
) -> dict[str, Any]:
    """Gera pauta nova com o Gemini, ciente do que já existe no board."""
    settings = current_settings(request)

    contexto: list[str] = []
    if pedido.usar_board and settings.trello_list_id_ideias:
        try:
            for list_id in (settings.trello_list_id_ideias, settings.trello_list_id_tarefas):
                if list_id:
                    contexto += [c.get("name", "") for c in client.list_cards(list_id, limit=20)]
        except TrelloError as exc:
            # Sem board não dá para evitar repetição, mas ainda dá para criar: segue.
            log.warning("Estúdio: sem contexto do board (%s)", exc)

    ideias = estudio.gerar_ideias(
        pedido.tema, quantidade=pedido.quantidade, contexto=contexto
    )
    log.info("Estúdio gerou %s ideia(s) sobre '%s'", len(ideias), pedido.tema[:60])
    return {"tema": pedido.tema, "ideias": [ideia.to_dict() for ideia in ideias]}


@app.post("/api/estudio/organizar")
def api_organizar(
    request: Request,
    client: TrelloClient = Depends(trello_client),
    estudio: EstudioCriativo = Depends(get_estudio),
) -> dict[str, Any]:
    """Lê o board e devolve prioridades, duplicatas e lacunas."""
    settings = current_settings(request)
    if not (settings.trello_list_id_ideias and settings.trello_list_id_tarefas):
        raise NotConfiguredError("Configure as listas do Trello antes de organizar o board.")

    ideias = client.list_cards(settings.trello_list_id_ideias, limit=40)
    tarefas = client.list_cards(settings.trello_list_id_tarefas, limit=40)
    analise = estudio.organizar(ideias, tarefas)
    log.info("Estúdio analisou o board (%s ideias, %s tarefas)", len(ideias), len(tarefas))
    return analise


class CartaoNovo(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = ""
    formato: str = ""
    esforco: str = ""
    due_date: str | None = None


class PedidoCriarCartoes(BaseModel):
    destino: str = Field(default="ideias", pattern="^(ideias|tarefas)$")
    ideias: list[CartaoNovo] = Field(min_length=1, max_length=10)


@app.post("/api/estudio/criar-cartoes")
def api_criar_cartoes(
    pedido: PedidoCriarCartoes,
    request: Request,
    client: TrelloClient = Depends(trello_client),
) -> dict[str, Any]:
    """Manda para o Trello as ideias que a equipe aprovou no painel."""
    settings = current_settings(request)
    list_id = (
        settings.trello_list_id_ideias
        if pedido.destino == "ideias"
        else settings.trello_list_id_tarefas
    )
    if not list_id:
        raise NotConfiguredError(f"A lista de {pedido.destino} não está configurada.")

    criados = []
    for item in pedido.ideias:
        ideia = Ideia(
            title=item.title,
            description=item.description,
            formato=item.formato,
            esforco=item.esforco,
            due_date=item.due_date,
        )
        card = client.create_card(
            list_id=list_id,
            name=ideia.title,
            description=_descricao_da_ideia(ideia),
            due=ideia.due_date,
        )
        criados.append(
            {"title": ideia.title, "url": card.get("shortUrl"), "id": card.get("id")}
        )
    log.info("Estúdio criou %s cartão(ões) em %s", len(criados), pedido.destino)
    return {"status": "created", "destino": pedido.destino, "cartoes": criados}


def _descricao_da_ideia(ideia: Ideia) -> str:
    partes = [ideia.description.strip()]
    meta = []
    if ideia.formato:
        meta.append(f"**Formato:** {ideia.formato}")
    if ideia.esforco:
        meta.append(f"**Esforço:** {ideia.esforco}")
    if meta:
        partes.append(" · ".join(meta))
    partes.append("_Ideia gerada pelo Estúdio Criativo do Cérebro de Operações._")
    return "\n\n".join(parte for parte in partes if parte)


# ---------------------------------------------------------------------- webhooks
@app.post("/webhook", response_model=WebhookResponse, status_code=status.HTTP_200_OK)
def webhook(
    message: WebhookMessage,
    pipeline: Pipeline = Depends(get_pipeline),
    store: Store = Depends(get_store),
) -> WebhookResponse:
    """Entrada manual: uma mensagem digitada ou colada no painel."""
    return _processar_e_registrar(pipeline, store, message, origem="painel")


@app.get("/webhook/whatsapp", include_in_schema=False)
def whatsapp_verificacao(request: Request):
    """Handshake da Meta Cloud API (hub.challenge)."""
    settings: Settings | None = getattr(request.app.state, "settings", None)
    esperado = settings.whatsapp_verify_token if settings else ""
    parametros = request.query_params
    if parametros.get("hub.mode") == "subscribe" and esperado and (
        parametros.get("hub.verify_token") == esperado
    ):
        log.info("WhatsApp: verificação da Meta aceita.")
        return PlainTextResponse(parametros.get("hub.challenge", ""))
    return JSONResponse(
        status_code=status.HTTP_403_FORBIDDEN,
        content={"status": "error", "stage": "whatsapp", "detail": "verify_token inválido"},
    )


@app.post("/webhook/whatsapp")
async def whatsapp_webhook(
    request: Request,
    pipeline: Pipeline | None = Depends(get_pipeline_opcional),
    store: Store = Depends(get_store),
) -> Response:
    """Entrada automática: mensagens que chegam do grupo, sem ninguém copiar nada."""
    settings = current_settings(request)
    if not settings.whatsapp_ativo:
        raise NotConfiguredError(
            "WhatsApp desligado. Escolha um provedor na aba WhatsApp do painel."
        )

    corpo = await request.body()

    if settings.whatsapp_provider == "meta":
        if not verificar_assinatura_meta(
            corpo, request.headers.get("x-hub-signature-256"), settings.whatsapp_app_secret
        ):
            log.warning("WhatsApp: assinatura da Meta inválida — descartado.")
            return JSONResponse(status_code=401, content={"status": "error", "stage": "whatsapp"})
    elif settings.whatsapp_provider in ("evolution", "generico"):
        recebida = request.headers.get("apikey") or request.headers.get("x-api-key")
        if not verificar_apikey_evolution(recebida, settings.whatsapp_api_key):
            log.warning("WhatsApp: apikey inválida — descartado.")
            return JSONResponse(status_code=401, content={"status": "error", "stage": "whatsapp"})

    try:
        payload = await request.json()
    except Exception as exc:  # noqa: BLE001
        raise WhatsAppError(f"corpo não é JSON: {exc}") from exc

    evento = traduzir(
        payload,
        provedor=settings.whatsapp_provider,
        grupos=settings.whatsapp_grupos,
        ignorar_proprias=settings.whatsapp_ignorar_proprias,
    )
    if not evento.processar:
        log.info("WhatsApp: %s", evento.motivo_ignorado)
        return JSONResponse({"status": "skipped", "detail": evento.motivo_ignorado})

    mensagem = evento.mensagem

    # Sem listas configuradas, a mensagem é guardada e processada depois — nada se perde.
    if pipeline is None:
        guardada = store.registrar(
            mensagem.text,
            autor=mensagem.sender,
            grupo=mensagem.group,
            origem="whatsapp",
            external_id=evento.external_id,
        )
        if guardada is None:
            return JSONResponse({"status": "duplicate", "detail": "mensagem já recebida"})
        log.warning("WhatsApp: mensagem enfileirada (listas do Trello ainda não configuradas).")
        return JSONResponse({"status": "queued", "detail": "aguardando configuração das listas"})

    try:
        resposta = await run_in_threadpool(
            _processar_e_registrar,
            pipeline,
            store,
            mensagem,
            origem="whatsapp",
            external_id=evento.external_id,
        )
    except (GeminiAnalysisError, TrelloError) as exc:
        # A mensagem já está gravada e será reprocessada pelo worker: responde 200
        # para o provedor não ficar reenviando o mesmo evento.
        log.error("WhatsApp: falha ao processar, ficou na fila (%s)", exc)
        return JSONResponse({"status": "queued", "detail": str(exc)})
    return JSONResponse(resposta.model_dump())


# --------------------------------------------------------------- tratamento de erros
@app.exception_handler(NotConfiguredError)
async def _not_configured(_: Request, exc: NotConfiguredError) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={"status": "error", "stage": "config", "detail": str(exc)},
    )


@app.exception_handler(WhatsAppError)
async def _whatsapp_error(_: Request, exc: WhatsAppError) -> JSONResponse:
    log.error("%s %s", red("WhatsApp:"), exc)
    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content={"status": "error", "stage": "whatsapp", "detail": str(exc)},
    )


@app.exception_handler(GeminiAnalysisError)
async def _gemini_error(_: Request, exc: GeminiAnalysisError) -> JSONResponse:
    log.error("%s %s", red("Falha na análise do Gemini:"), exc)
    return JSONResponse(
        status_code=status.HTTP_502_BAD_GATEWAY,
        content={"status": "error", "stage": "gemini", "detail": str(exc)},
    )


@app.exception_handler(TrelloError)
async def _trello_error(_: Request, exc: TrelloError) -> JSONResponse:
    log.error("%s %s", red("Falha ao falar com o Trello:"), exc)
    return JSONResponse(
        status_code=status.HTTP_502_BAD_GATEWAY,
        content={"status": "error", "stage": "trello", "detail": str(exc)},
    )


@app.exception_handler(ValueError)
async def _value_error(_: Request, exc: ValueError) -> JSONResponse:
    log.error("%s %s", red("Requisição/configuração inválida:"), exc)
    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content={"status": "error", "stage": "pipeline", "detail": str(exc)},
    )


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8000"))
    try:
        settings = get_settings()
        host, port = settings.host, settings.port
    except ConfigError as exc:
        log.warning("%s %s", yellow("Configuração incompleta:"), exc)

    uvicorn.run("main:app", host=host, port=port, reload=True, log_level="warning")
