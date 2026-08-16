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
from cerebro.comandos import AJUDA, AJUDA_TEXTO, DESVINCULAR, LISTAR, STATUS, VINCULAR
from cerebro.comandos import interpretar as interpretar_comando
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
from cerebro.workspaces import Area, AreaError, AreaStore

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
    app.state.pipelines = {}
    app.state.settings = None
    app.state.config_error = None
    app.state.store = None
    app.state.areas = None
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
        app.state.areas = AreaStore(settings.db_path, timezone=settings.timezone)
        migrada = app.state.areas.migrar_do_env(settings)
        if migrada:
            log.info("Área criada a partir do .env: %s", migrada.nome)

        banner(settings.host, settings.port, settings.gemini_model)
        areas = app.state.areas.listar()
        if areas:
            for area in areas:
                marca = " (padrão)" if area.padrao else ""
                estado = "pronta" if area.pronta else "sem listas"
                vinculos = len(app.state.areas.vinculos(area.id))
                log.info("Área %s%s — %s · %s vínculo(s)", area.nome, marca, estado, vinculos)
        else:
            log.warning("%s", yellow("Nenhuma área cadastrada — crie a primeira no painel."))
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
    for recurso in ("store", "areas"):
        if getattr(app.state, recurso, None):
            getattr(app.state, recurso).close()
    log.info("Cérebro encerrado.")


async def _worker_fila(app: FastAPI) -> None:
    """Reprocessa em segundo plano o que ficou pendente (queda de rede, API fora)."""
    while True:
        settings: Settings | None = getattr(app.state, "settings", None)
        intervalo = settings.fila_intervalo if settings else 20.0
        try:
            await asyncio.sleep(intervalo)
            store: Store | None = getattr(app.state, "store", None)
            areas: AreaStore | None = getattr(app.state, "areas", None)
            if store is None or areas is None or settings is None:
                continue
            vencidas = await run_in_threadpool(store.pendentes_vencidas, 5)
            if not vencidas:
                continue
            log.info("Fila: reprocessando %s mensagem(ns)…", len(vencidas))
            for linha in vencidas:
                area = _area_da_linha(areas, linha)
                if area is None or not area.pronta:
                    store.marcar_falha(
                        linha["id"], "config",
                        "nenhuma área pronta para esta mensagem", reagendar=True,
                    )
                    continue
                pipeline = _pipeline_da_area(app, settings, area)
                await run_in_threadpool(_processar_linha, pipeline, store, linha)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 — o worker nunca pode morrer
            log.error("Fila: erro inesperado no worker: %s", exc)


def _area_da_linha(areas: AreaStore, linha: dict[str, Any]) -> Area | None:
    """Área gravada na mensagem; se ela sumiu, tenta resolver pelo grupo/autor."""
    if linha.get("area_id"):
        try:
            return areas.obter(int(linha["area_id"]))
        except AreaError:
            pass
    return areas.resolver(grupo=linha.get("grupo"), autor=linha.get("autor"))


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


def get_store(request: Request) -> Store:
    store: Store | None = getattr(request.app.state, "store", None)
    if store is None:
        settings = current_settings(request)
        store = Store(settings.db_path, timezone=settings.timezone)
        request.app.state.store = store
    return store


def get_areas(request: Request) -> AreaStore:
    areas: AreaStore | None = getattr(request.app.state, "areas", None)
    if areas is None:
        settings = current_settings(request)
        areas = AreaStore(settings.db_path, timezone=settings.timezone)
        request.app.state.areas = areas
    return areas


def area_selecionada(request: Request, area_id: int | None = None) -> Area:
    """Área alvo da requisição: a informada, ou a padrão."""
    areas = get_areas(request)
    if area_id:
        try:
            return areas.obter(area_id)
        except AreaError as exc:
            raise NotConfiguredError(str(exc)) from exc
    padrao = areas.padrao()
    if padrao is None:
        raise NotConfiguredError(
            "Nenhuma área de trabalho cadastrada. Crie a primeira na aba Áreas."
        )
    return padrao


def trello_da_area(request: Request, area: Area) -> TrelloClient:
    settings = current_settings(request)
    chave, token = area.credenciais(settings.trello_api_key, settings.trello_token)
    if not (chave and token):
        raise NotConfiguredError(
            f"A área '{area.nome}' não tem chave/token do Trello, e não há chave global."
        )
    return TrelloClient(chave, token, timeout=settings.request_timeout)


def trello_client(request: Request) -> TrelloClient:
    """Cliente da área padrão — usado pelas rotas que não recebem area_id."""
    return trello_da_area(request, area_selecionada(request))


def _pipeline_da_area(app: FastAPI, settings: Settings, area: Area) -> Pipeline:
    cache: dict[int, tuple[Any, Pipeline]] = getattr(app.state, "pipelines", None) or {}
    app.state.pipelines = cache
    assinatura = (
        settings, area.trello_key, area.trello_token, area.list_ideias, area.list_tarefas,
        area.nome,
    )
    guardado = cache.get(area.id)
    if guardado and guardado[0] == assinatura:
        return guardado[1]
    pipeline = build_pipeline(settings, area)
    cache[area.id] = (assinatura, pipeline)
    return pipeline


def pipeline_para(request: Request, area: Area) -> Pipeline:
    if not area.pronta:
        raise NotConfiguredError(
            f"A área '{area.nome}' ainda não tem as colunas de ideias e tarefas escolhidas."
        )
    return _pipeline_da_area(request.app, current_settings(request), area)


def get_pipeline(request: Request) -> Pipeline:
    """Pipeline da área padrão — usado pelo webhook manual sem area_id."""
    return pipeline_para(request, area_selecionada(request))


def get_estudio(request: Request) -> EstudioCriativo:
    settings = current_settings(request)
    estudio: EstudioCriativo | None = getattr(request.app.state, "estudio", None)
    if estudio is None:
        estudio = EstudioCriativo(settings)
        request.app.state.estudio = estudio
    return estudio


def _processar_e_registrar(
    pipeline: Pipeline, store: Store, mensagem: WebhookMessage, *, origem: str,
    external_id: str | None = None, area: Area | None = None,
) -> WebhookResponse:
    """Grava, processa e atualiza o estado — o caminho único de toda mensagem."""
    mensagem_id = store.registrar(
        mensagem.text,
        autor=mensagem.sender,
        grupo=mensagem.group,
        origem=origem,
        external_id=external_id,
        area_id=area.id if area else None,
        area_nome=area.nome if area else None,
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
    areas: AreaStore | None = getattr(request.app.state, "areas", None)
    prontas = [a for a in areas.listar() if a.pronta] if areas else []
    return {
        "status": "ok",
        "version": __version__,
        "model": settings.gemini_model if settings else None,
        "areas": len(prontas),
    }


@app.get("/api/status")
def api_status(request: Request) -> dict[str, Any]:
    """Tudo que o painel precisa para se desenhar."""
    settings: Settings | None = getattr(request.app.state, "settings", None)
    store: Store | None = getattr(request.app.state, "store", None)
    areas: AreaStore | None = getattr(request.app.state, "areas", None)

    resultado: dict[str, Any] = {
        "version": __version__,
        "env_path": str(ENV_PATH),
        "config_error": getattr(request.app.state, "config_error", None),
        "model": settings.gemini_model if settings else None,
        "timezone": settings.timezone if settings else None,
        "ready": False,
        "chaves": {
            "gemini": bool(settings and settings.gemini_api_key),
            "trello": bool(settings and settings.trello_api_key and settings.trello_token),
            "trello_secret": bool(settings and settings.trello_secret),
        },
        "areas": [],
        "area_padrao": None,
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
    if settings is None or areas is None:
        return resultado

    vinculos_por_area: dict[int, list[dict[str, Any]]] = {}
    for vinculo in areas.vinculos():
        vinculos_por_area.setdefault(vinculo.area_id, []).append(vinculo.to_dict())

    lista = []
    for area in areas.listar():
        dados = area.to_dict()
        dados["vinculos"] = vinculos_por_area.get(area.id, [])
        lista.append(dados)
    resultado["areas"] = lista
    padrao = areas.padrao()
    resultado["area_padrao"] = padrao.id if padrao else None
    resultado["ready"] = any(area["pronta"] for area in lista)
    return resultado


# ------------------------------------------------------------------ áreas de trabalho
class AreaEntrada(BaseModel):
    nome: str = Field(min_length=2, max_length=80)
    trello_key: str = ""
    trello_token: str = ""
    trello_secret: str = ""
    board_id: str = ""
    board_nome: str = ""
    list_ideias: str = ""
    list_ideias_nome: str = ""
    list_tarefas: str = ""
    list_tarefas_nome: str = ""


class AreaEdicao(BaseModel):
    nome: str | None = Field(default=None, min_length=2, max_length=80)
    trello_key: str | None = None
    trello_token: str | None = None
    trello_secret: str | None = None
    board_id: str | None = None
    board_nome: str | None = None
    list_ideias: str | None = None
    list_ideias_nome: str | None = None
    list_tarefas: str | None = None
    list_tarefas_nome: str | None = None


@app.get("/api/areas")
def api_listar_areas(areas: AreaStore = Depends(get_areas)) -> list[dict[str, Any]]:
    vinculos_por_area: dict[int, list[dict[str, Any]]] = {}
    for vinculo in areas.vinculos():
        vinculos_por_area.setdefault(vinculo.area_id, []).append(vinculo.to_dict())
    saida = []
    for area in areas.listar():
        dados = area.to_dict()
        dados["vinculos"] = vinculos_por_area.get(area.id, [])
        saida.append(dados)
    return saida


@app.post("/api/areas", status_code=status.HTTP_201_CREATED)
def api_criar_area(
    entrada: AreaEntrada, request: Request, areas: AreaStore = Depends(get_areas)
) -> dict[str, Any]:
    campos = entrada.model_dump()
    nome = campos.pop("nome")
    area = areas.criar(nome, **{k: v for k, v in campos.items() if v})
    request.app.state.pipelines = {}
    log.info("Área criada: %s", area.nome)
    return area.to_dict()


@app.patch("/api/areas/{area_id}")
def api_editar_area(
    area_id: int, edicao: AreaEdicao, request: Request, areas: AreaStore = Depends(get_areas)
) -> dict[str, Any]:
    campos = {k: v for k, v in edicao.model_dump().items() if v is not None}
    area = areas.atualizar(area_id, **campos)
    request.app.state.pipelines = {}
    log.info("Área atualizada: %s", area.nome)
    return area.to_dict()


@app.delete("/api/areas/{area_id}")
def api_remover_area(
    area_id: int, request: Request, areas: AreaStore = Depends(get_areas)
) -> dict[str, str]:
    area = areas.obter(area_id)
    areas.remover(area_id)
    request.app.state.pipelines = {}
    log.info("Área removida: %s", area.nome)
    return {"status": "removed", "nome": area.nome}


@app.post("/api/areas/{area_id}/padrao")
def api_definir_padrao(
    area_id: int, areas: AreaStore = Depends(get_areas)
) -> dict[str, Any]:
    return areas.definir_padrao(area_id).to_dict()


class VinculoEntrada(BaseModel):
    identificador: str = Field(min_length=2, max_length=120)
    tipo: str = Field(default="grupo", pattern="^(grupo|contato)$")


@app.get("/api/areas/{area_id}/vinculos")
def api_listar_vinculos(
    area_id: int, areas: AreaStore = Depends(get_areas)
) -> list[dict[str, Any]]:
    areas.obter(area_id)
    return [vinculo.to_dict() for vinculo in areas.vinculos(area_id)]


@app.post("/api/areas/{area_id}/vinculos", status_code=status.HTTP_201_CREATED)
def api_criar_vinculo(
    area_id: int, entrada: VinculoEntrada, areas: AreaStore = Depends(get_areas)
) -> dict[str, Any]:
    vinculo = areas.vincular(area_id, entrada.identificador, entrada.tipo)
    area = areas.obter(area_id)
    log.info("Vínculo: %s '%s' → %s", entrada.tipo, entrada.identificador, area.nome)
    return vinculo.to_dict()


@app.delete("/api/vinculos/{vinculo_id}")
def api_remover_vinculo(
    vinculo_id: int, areas: AreaStore = Depends(get_areas)
) -> dict[str, Any]:
    removido = areas.desvincular(vinculo_id=vinculo_id)
    if not removido:
        raise AreaError(f"vínculo {vinculo_id} não encontrado")
    return {"status": "removed"}


# -------------------------------------------------------------------- credenciais
class ChavesEntrada(BaseModel):
    """Campos em branco preservam o valor atual — nunca apagam por engano."""

    gemini_api_key: str | None = None
    gemini_model: str | None = None
    trello_api_key: str | None = None
    trello_token: str | None = None
    trello_secret: str | None = None


@app.post("/api/config/chaves")
def api_salvar_chaves(entrada: ChavesEntrada, request: Request) -> dict[str, Any]:
    """Grava as chaves globais no .env, direto pelo painel."""
    mapa = {
        "gemini_api_key": "GEMINI_API_KEY",
        "gemini_model": "GEMINI_MODEL",
        "trello_api_key": "TRELLO_API_KEY",
        "trello_token": "TRELLO_TOKEN",
        "trello_secret": "TRELLO_SECRET",
    }
    valores = {
        variavel: getattr(entrada, campo).strip()
        for campo, variavel in mapa.items()
        if getattr(entrada, campo) is not None and getattr(entrada, campo).strip()
    }
    if not valores:
        raise ValueError("Nenhuma chave informada.")
    write_env_values(valores)

    try:
        settings = reload_settings()
    except ConfigError as exc:
        request.app.state.config_error = str(exc)
        raise NotConfiguredError(str(exc)) from exc

    request.app.state.settings = settings
    request.app.state.config_error = None
    request.app.state.pipelines = {}
    request.app.state.estudio = None
    log.info("Chaves atualizadas: %s", ", ".join(sorted(valores)))
    return {"status": "saved", "atualizadas": sorted(valores)}


class TesteCredenciais(BaseModel):
    trello_key: str = ""
    trello_token: str = ""
    area_id: int | None = None


@app.post("/api/trello/boards")
def api_boards_de(entrada: TesteCredenciais, request: Request) -> list[dict[str, Any]]:
    """Boards visíveis para um par de credenciais — permite testar antes de salvar.

    Sem credenciais no corpo, usa as da área informada (ou as globais).
    """
    settings = current_settings(request)
    chave, token = entrada.trello_key.strip(), entrada.trello_token.strip()
    if not (chave and token):
        if entrada.area_id:
            area = get_areas(request).obter(entrada.area_id)
            chave, token = area.credenciais(settings.trello_api_key, settings.trello_token)
        else:
            chave, token = settings.trello_api_key, settings.trello_token
    if not (chave and token):
        raise NotConfiguredError("Informe a chave e o token do Trello.")

    client = TrelloClient(chave, token, timeout=settings.request_timeout)
    return _boards_com_listas(client)


@app.get("/api/boards")
def api_boards(client: TrelloClient = Depends(trello_client)) -> list[dict[str, Any]]:
    """Boards da área padrão (ou das credenciais globais)."""
    return _boards_com_listas(client)


def _boards_com_listas(client: TrelloClient) -> list[dict[str, Any]]:
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
def api_cards(request: Request, area_id: int | None = None, limite: int = 12) -> dict[str, Any]:
    """Últimos cartões das duas colunas da área escolhida."""
    area = area_selecionada(request, area_id)
    client = trello_da_area(request, area)
    saida: dict[str, Any] = {"area": area.nome, "area_id": area.id}
    for chave, list_id in (("ideias", area.list_ideias), ("tarefas", area.list_tarefas)):
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
    area_id: int | None = None


@app.post("/api/estudio/ideias")
def api_gerar_ideias(
    pedido: PedidoIdeias, request: Request, estudio: EstudioCriativo = Depends(get_estudio)
) -> dict[str, Any]:
    """Gera pauta nova com o Gemini, ciente do que já existe no board da área."""
    area = area_selecionada(request, pedido.area_id)

    contexto: list[str] = []
    if pedido.usar_board and area.list_ideias:
        try:
            client = trello_da_area(request, area)
            for list_id in (area.list_ideias, area.list_tarefas):
                if list_id:
                    contexto += [c.get("name", "") for c in client.list_cards(list_id, limit=20)]
        except (TrelloError, NotConfiguredError) as exc:
            # Sem board não dá para evitar repetição, mas ainda dá para criar: segue.
            log.warning("Estúdio: sem contexto do board (%s)", exc)

    ideias = estudio.gerar_ideias(pedido.tema, quantidade=pedido.quantidade, contexto=contexto)
    log.info("Estúdio gerou %s ideia(s) sobre '%s' (%s)", len(ideias), pedido.tema[:50], area.nome)
    return {"tema": pedido.tema, "area": area.nome, "ideias": [i.to_dict() for i in ideias]}


class PedidoOrganizar(BaseModel):
    area_id: int | None = None


@app.post("/api/estudio/organizar")
def api_organizar(
    pedido: PedidoOrganizar, request: Request, estudio: EstudioCriativo = Depends(get_estudio)
) -> dict[str, Any]:
    """Lê o board da área e devolve prioridades, duplicatas e lacunas."""
    area = area_selecionada(request, pedido.area_id)
    if not area.pronta:
        raise NotConfiguredError(f"A área '{area.nome}' ainda não tem as colunas escolhidas.")

    client = trello_da_area(request, area)
    ideias = client.list_cards(area.list_ideias, limit=40)
    tarefas = client.list_cards(area.list_tarefas, limit=40)
    analise = estudio.organizar(ideias, tarefas)
    analise["area"] = area.nome
    log.info("Estúdio analisou %s (%s ideias, %s tarefas)", area.nome, len(ideias), len(tarefas))
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
    area_id: int | None = None


@app.post("/api/estudio/criar-cartoes")
def api_criar_cartoes(pedido: PedidoCriarCartoes, request: Request) -> dict[str, Any]:
    """Manda para o Trello as ideias que a equipe aprovou no painel."""
    area = area_selecionada(request, pedido.area_id)
    list_id = area.list_ideias if pedido.destino == "ideias" else area.list_tarefas
    if not list_id:
        raise NotConfiguredError(
            f"A lista de {pedido.destino} da área '{area.nome}' não está configurada."
        )

    client = trello_da_area(request, area)
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
            description=_descricao_da_ideia(ideia, area.nome),
            due=ideia.due_date,
        )
        criados.append({"title": ideia.title, "url": card.get("shortUrl"), "id": card.get("id")})
    log.info("Estúdio criou %s cartão(ões) em %s/%s", len(criados), area.nome, pedido.destino)
    return {"status": "created", "destino": pedido.destino, "area": area.nome, "cartoes": criados}


def _descricao_da_ideia(ideia: Ideia, area_nome: str = "") -> str:
    partes = [ideia.description.strip()]
    meta = []
    if ideia.formato:
        meta.append(f"**Formato:** {ideia.formato}")
    if ideia.esforco:
        meta.append(f"**Esforço:** {ideia.esforco}")
    if meta:
        partes.append(" · ".join(meta))
    rodape = "_Ideia gerada pelo Estúdio Criativo do Cérebro de Operações"
    partes.append(f"{rodape} ({area_nome})._" if area_nome else f"{rodape}._")
    return "\n\n".join(parte for parte in partes if parte)


# ---------------------------------------------------------------------- webhooks
class MensagemManual(WebhookMessage):
    area_id: int | None = None


@app.post("/webhook", response_model=WebhookResponse, status_code=status.HTTP_200_OK)
def webhook(
    message: MensagemManual, request: Request, store: Store = Depends(get_store)
) -> WebhookResponse:
    """Entrada manual: uma mensagem digitada ou colada no painel."""
    area = area_selecionada(request, message.area_id)
    pipeline = pipeline_para(request, area)
    limpa = WebhookMessage(text=message.text, sender=message.sender, group=message.group)
    return _processar_e_registrar(pipeline, store, limpa, origem="painel", area=area)


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
    store: Store = Depends(get_store),
    areas: AreaStore = Depends(get_areas),
) -> Response:
    """Entrada automática: mensagens do grupo, sem ninguém copiar nada."""
    settings = current_settings(request)
    if not settings.whatsapp_ativo:
        raise NotConfiguredError(
            "WhatsApp desligado. Escolha um provedor na aba Conexões do painel."
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

    # 1) Comandos de operação são resolvidos aqui e não gastam cota do Gemini.
    comando = interpretar_comando(mensagem.text)
    if comando:
        resultado = await run_in_threadpool(_executar_comando, comando, mensagem, areas, store)
        return JSONResponse(resultado)

    # 2) Roteamento: o grupo manda na área de destino.
    area = areas.resolver(grupo=mensagem.group, autor=mensagem.sender)
    if area is None or not area.pronta:
        store.registrar(
            mensagem.text,
            autor=mensagem.sender,
            grupo=mensagem.group,
            origem="whatsapp",
            external_id=evento.external_id,
            area_id=area.id if area else None,
            area_nome=area.nome if area else None,
        )
        motivo = (
            "nenhuma área vinculada a este grupo"
            if area is None
            else f"a área {area.nome} ainda não tem as colunas escolhidas"
        )
        log.warning("WhatsApp: mensagem enfileirada — %s.", motivo)
        return JSONResponse({"status": "queued", "detail": motivo})

    try:
        pipeline = _pipeline_da_area(request.app, settings, area)
        resposta = await run_in_threadpool(
            _processar_e_registrar,
            pipeline,
            store,
            mensagem,
            origem="whatsapp",
            external_id=evento.external_id,
            area=area,
        )
    except (GeminiAnalysisError, TrelloError) as exc:
        # A mensagem já está gravada e será reprocessada pelo worker: responde 200
        # para o provedor não ficar reenviando o mesmo evento.
        log.error("WhatsApp: falha ao processar, ficou na fila (%s)", exc)
        return JSONResponse({"status": "queued", "detail": str(exc)})
    return JSONResponse(resposta.model_dump())


def _executar_comando(comando, mensagem: WebhookMessage, areas: AreaStore, store: Store) -> dict:
    """Executa START/PARAR/STATUS/AREAS vindos do próprio grupo."""
    alvo_conversa = mensagem.group or mensagem.sender or ""
    tipo = "grupo" if mensagem.group else "contato"
    if not alvo_conversa:
        return {"status": "skipped", "detail": "comando sem grupo/contato de origem"}

    if comando.acao == VINCULAR:
        area = areas.obter_por_nome(comando.alvo)
        if area is None:
            nomes = ", ".join(a.nome for a in areas.listar()) or "(nenhuma cadastrada)"
            detalhe = f"Área '{comando.alvo}' não encontrada. Cadastradas: {nomes}"
            store.registrar_evento(mensagem.text, detalhe, autor=mensagem.sender,
                                   grupo=mensagem.group)
            log.warning("Comando: %s", detalhe)
            return {"status": "command_failed", "detail": detalhe}
        areas.vincular(area.id, alvo_conversa, tipo)
        detalhe = f"{tipo.capitalize()} '{alvo_conversa}' ligado à área {area.nome}"
        store.registrar_evento(mensagem.text, detalhe, autor=mensagem.sender,
                               grupo=mensagem.group, area_nome=area.nome)
        log.info("Comando: %s", detalhe)
        return {"status": "command", "detail": detalhe, "area": area.nome}

    if comando.acao == DESVINCULAR:
        removido = areas.desvincular(identificador=alvo_conversa, tipo=tipo)
        detalhe = (
            f"{tipo.capitalize()} '{alvo_conversa}' desligado do Trello"
            if removido
            else f"{tipo.capitalize()} '{alvo_conversa}' já não estava ligado a nenhuma área"
        )
        store.registrar_evento(mensagem.text, detalhe, autor=mensagem.sender,
                               grupo=mensagem.group)
        log.info("Comando: %s", detalhe)
        return {"status": "command", "detail": detalhe}

    if comando.acao == STATUS:
        area = areas.area_de(alvo_conversa, tipo)
        detalhe = (
            f"'{alvo_conversa}' está ligado à área {area.nome}"
            if area
            else f"'{alvo_conversa}' não está ligado a nenhuma área"
        )
        store.registrar_evento(mensagem.text, detalhe, autor=mensagem.sender,
                               grupo=mensagem.group, area_nome=area.nome if area else None)
        return {"status": "command", "detail": detalhe}

    if comando.acao == LISTAR:
        nomes = ", ".join(a.nome for a in areas.listar()) or "(nenhuma cadastrada)"
        detalhe = f"Áreas cadastradas: {nomes}"
        store.registrar_evento(mensagem.text, detalhe, autor=mensagem.sender,
                               grupo=mensagem.group)
        return {"status": "command", "detail": detalhe}

    if comando.acao == AJUDA:
        store.registrar_evento(mensagem.text, AJUDA_TEXTO, autor=mensagem.sender,
                               grupo=mensagem.group)
        return {"status": "command", "detail": AJUDA_TEXTO}

    return {"status": "skipped", "detail": "comando não reconhecido"}


# --------------------------------------------------------------- tratamento de erros
@app.exception_handler(NotConfiguredError)
async def _not_configured(_: Request, exc: NotConfiguredError) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={"status": "error", "stage": "config", "detail": str(exc)},
    )


@app.exception_handler(AreaError)
async def _area_error(_: Request, exc: AreaError) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content={"status": "error", "stage": "areas", "detail": str(exc)},
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
