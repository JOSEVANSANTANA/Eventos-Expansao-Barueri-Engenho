"""Cérebro de Operações — API FastAPI + painel web.

Sobe com:
    uvicorn main:app --reload
ou simplesmente:
    python main.py
No Mac, o duplo clique em `Cerebro.command` faz isso e abre o Chrome no painel.
"""

from __future__ import annotations

import os
import signal
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, Depends, FastAPI, Request, status
from fastapi.responses import FileResponse, JSONResponse
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
from cerebro.gemini import GeminiAnalysisError
from cerebro.history import History
from cerebro.models import WebhookMessage, WebhookResponse
from cerebro.pipeline import Pipeline, build_pipeline
from cerebro.trello import TrelloClient, TrelloError

WEB_DIR = Path(__file__).resolve().parent / "web"


class NotConfiguredError(RuntimeError):
    """O app subiu, mas falta configuração para processar mensagens."""


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Sobe sempre — mesmo sem configuração — para o painel poder guiar o setup."""
    app.state.pipeline = None
    app.state.settings = None
    app.state.config_error = None
    app.state.history = History()

    try:
        settings: Settings = get_settings()
        app.state.settings = settings
    except ConfigError as exc:
        app.state.config_error = str(exc)
        log.error("%s %s", red("Configuração incompleta:"), exc)
        log.warning("O painel abriu mesmo assim — termine a configuração por lá.")
        settings = None

    if settings:
        banner(settings.host, settings.port, settings.gemini_model)
        if settings.trello_list_id_ideias and settings.trello_list_id_tarefas:
            log.info("Lista de IDEIAS  → %s", settings.trello_list_id_ideias)
            log.info("Lista de TAREFAS → %s", settings.trello_list_id_tarefas)
            log.info("Pronto. Aguardando mensagens…")
        else:
            log.warning(
                "%s",
                yellow("Faltam os IDs das listas do Trello — escolha-os no painel."),
            )
    yield
    log.info("Cérebro encerrado.")


app = FastAPI(
    title="Cérebro de Operações",
    description="Recebe mensagens do grupo, classifica com Gemini e cria cartões no Trello.",
    version=__version__,
    lifespan=lifespan,
)

if WEB_DIR.is_dir():
    app.mount("/static", StaticFiles(directory=str(WEB_DIR)), name="static")


# --------------------------------------------------------------------- helpers
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


def get_pipeline(request: Request) -> Pipeline:
    """Pipeline montado sob demanda (e recriado quando a configuração muda)."""
    settings = current_settings(request)
    if not (settings.trello_list_id_ideias and settings.trello_list_id_tarefas):
        raise NotConfiguredError(
            "Escolha as listas do Trello para IDEIAS e TAREFAS antes de processar mensagens."
        )
    pipeline: Pipeline | None = getattr(request.app.state, "pipeline", None)
    if pipeline is None or pipeline.settings != settings:
        pipeline = build_pipeline(settings)
        request.app.state.pipeline = pipeline
    return pipeline


def get_history(request: Request) -> History:
    history: History | None = getattr(request.app.state, "history", None)
    if history is None:
        history = History()
        request.app.state.history = history
    return history


# ------------------------------------------------------------------- painel web
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
    resultado: dict[str, Any] = {
        "version": __version__,
        "env_path": str(ENV_PATH),
        "config_error": getattr(request.app.state, "config_error", None),
        "model": settings.gemini_model if settings else None,
        "timezone": settings.timezone if settings else None,
        "ready": False,
        "trello_user": None,
        "lists": {"ideias": None, "tarefas": None},
    }
    if settings is None:
        return resultado

    resultado["lists"] = {
        "ideias": {"id": settings.trello_list_id_ideias or None, "name": None},
        "tarefas": {"id": settings.trello_list_id_tarefas or None, "name": None},
    }
    resultado["ready"] = bool(
        settings.trello_list_id_ideias and settings.trello_list_id_tarefas
    )

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
    boards = []
    for board in client.list_boards():
        boards.append(
            {
                "id": board["id"],
                "name": board.get("name", "sem nome"),
                "url": board.get("url"),
                "lists": [
                    {"id": lista["id"], "name": lista.get("name", "sem nome")}
                    for lista in client.list_lists(board["id"])
                ],
            }
        )
    return boards


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
    request.app.state.pipeline = None  # remontado na próxima mensagem
    log.info("Listas atualizadas: IDEIAS=%s · TAREFAS=%s", config.ideias, config.tarefas)
    return {"status": "saved", "env_path": str(ENV_PATH)}


@app.get("/api/cards")
def api_cards(request: Request, limite: int = 12) -> dict[str, Any]:
    """Últimos cartões das duas colunas, para acompanhar o board sem sair do painel."""
    settings = current_settings(request)
    client = TrelloClient(
        settings.trello_api_key, settings.trello_token, timeout=settings.request_timeout
    )
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
def api_history(history: History = Depends(get_history)) -> list[dict[str, Any]]:
    return history.items()


@app.delete("/api/history")
def api_limpar_history(history: History = Depends(get_history)) -> dict[str, str]:
    history.clear()
    return {"status": "cleared"}


@app.post("/api/shutdown")
def api_shutdown(background: BackgroundTasks) -> dict[str, str]:
    """Botão 'Encerrar' do painel — derruba o servidor local."""
    log.info("Encerrando a pedido do painel…")
    background.add_task(_encerrar)
    return {"status": "stopping"}


def _encerrar() -> None:
    threading.Timer(0.4, lambda: os.kill(os.getpid(), signal.SIGTERM)).start()


# ---------------------------------------------------------------------- webhook
@app.post("/webhook", response_model=WebhookResponse, status_code=status.HTTP_200_OK)
def webhook(
    message: WebhookMessage,
    pipeline: Pipeline = Depends(get_pipeline),
    history: History = Depends(get_history),
) -> WebhookResponse:
    """Entrada única do sistema: uma mensagem de texto do grupo."""
    try:
        resposta = pipeline.process(message)
    except GeminiAnalysisError as exc:
        history.record_error(message, "gemini", str(exc))
        raise
    except TrelloError as exc:
        history.record_error(message, "trello", str(exc))
        raise
    history.record(message, resposta)
    return resposta


# ------------------------------------------------------------- tratamento de erros
@app.exception_handler(NotConfiguredError)
async def _not_configured(_: Request, exc: NotConfiguredError) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={"status": "error", "stage": "config", "detail": str(exc)},
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
