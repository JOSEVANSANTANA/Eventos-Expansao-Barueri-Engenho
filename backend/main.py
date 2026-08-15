"""Cérebro de Operações — API FastAPI.

Sobe com:
    uvicorn main:app --reload
ou simplesmente:
    python main.py
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request, status
from fastapi.responses import JSONResponse

from cerebro import __version__
from cerebro.config import ConfigError, Settings, get_settings
from cerebro.console import banner, log, red
from cerebro.gemini import GeminiAnalysisError
from cerebro.models import WebhookMessage, WebhookResponse
from cerebro.pipeline import Pipeline, build_pipeline
from cerebro.trello import TrelloError


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Valida credenciais e monta o pipeline uma única vez, no boot."""
    try:
        settings: Settings = get_settings()
        app.state.settings = settings
        app.state.pipeline = build_pipeline(settings)
    except ConfigError as exc:
        log.error("%s %s", red("Configuração inválida:"), exc)
        raise RuntimeError(str(exc)) from exc

    banner(settings.host, settings.port, settings.gemini_model)
    log.info("Lista de IDEIAS  → %s", settings.trello_list_id_ideias)
    log.info("Lista de TAREFAS → %s", settings.trello_list_id_tarefas)
    log.info("Pronto. Aguardando mensagens…")
    yield
    log.info("Cérebro encerrado.")


app = FastAPI(
    title="Cérebro de Operações",
    description="Recebe mensagens do grupo, classifica com Gemini e cria cartões no Trello.",
    version=__version__,
    lifespan=lifespan,
)


def get_pipeline(request: Request) -> Pipeline:
    """Pipeline montado no lifespan — ponto único de injeção (e de override nos testes)."""
    pipeline = getattr(request.app.state, "pipeline", None)
    if pipeline is None:  # pragma: no cover - só ocorre se o lifespan não rodou
        raise RuntimeError("pipeline não inicializado")
    return pipeline


@app.get("/", include_in_schema=False)
def root() -> dict[str, str]:
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


@app.post("/webhook", response_model=WebhookResponse, status_code=status.HTTP_200_OK)
def webhook(
    message: WebhookMessage, pipeline: Pipeline = Depends(get_pipeline)
) -> WebhookResponse:
    """Entrada única do sistema: uma mensagem de texto do grupo."""
    return pipeline.process(message)


@app.exception_handler(GeminiAnalysisError)
async def _gemini_error(_: Request, exc: GeminiAnalysisError) -> JSONResponse:
    log.error("%s %s", red("Falha na análise do Gemini:"), exc)
    return JSONResponse(
        status_code=status.HTTP_502_BAD_GATEWAY,
        content={"status": "error", "stage": "gemini", "detail": str(exc)},
    )


@app.exception_handler(TrelloError)
async def _trello_error(_: Request, exc: TrelloError) -> JSONResponse:
    log.error("%s %s", red("Falha ao criar o cartão:"), exc)
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

    try:
        settings = get_settings()
        host, port = settings.host, settings.port
    except ConfigError as exc:
        log.error("%s %s", red("Configuração inválida:"), exc)
        raise SystemExit(1) from exc

    uvicorn.run("main:app", host=host, port=port, reload=True, log_level="warning")
