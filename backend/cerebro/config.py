"""Carregamento e validação das configurações (.env)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
ENV_PATH = BASE_DIR / ".env"

# Valores que existem no .env.example e não servem para nada em runtime.
PLACEHOLDERS = {"", "preencher_depois", "cole_aqui", "changeme"}


class ConfigError(RuntimeError):
    """Configuração ausente ou ainda com valor de exemplo."""


@dataclass(frozen=True)
class Settings:
    gemini_api_key: str
    gemini_model: str
    trello_api_key: str
    trello_token: str
    trello_list_id_ideias: str
    trello_list_id_tarefas: str
    timezone: str
    request_timeout: float
    host: str
    port: int


def _read(name: str, *, required: bool = True, default: str = "") -> str:
    value = (os.getenv(name) or "").strip()
    if value.lower() in PLACEHOLDERS:
        value = ""
    if not value:
        if required:
            raise ConfigError(
                f"{name} não está definido no .env "
                f"(esperado em {ENV_PATH}). Rode `python get_trello_lists.py` "
                f"se o que falta for um ID de lista do Trello."
            )
        return default
    return value


def load_settings(*, env_path: Path | None = None, override: bool = False) -> Settings:
    """Lê o .env do disco e devolve as configurações já validadas."""
    load_dotenv(dotenv_path=env_path or ENV_PATH, override=override)
    return Settings(
        gemini_api_key=_read("GEMINI_API_KEY"),
        gemini_model=_read("GEMINI_MODEL", required=False, default="gemini-1.5-flash"),
        trello_api_key=_read("TRELLO_API_KEY"),
        trello_token=_read("TRELLO_TOKEN"),
        trello_list_id_ideias=_read("TRELLO_LIST_ID_IDEIAS"),
        trello_list_id_tarefas=_read("TRELLO_LIST_ID_TAREFAS"),
        timezone=_read("TIMEZONE", required=False, default="America/Sao_Paulo"),
        request_timeout=float(_read("REQUEST_TIMEOUT", required=False, default="15")),
        host=_read("HOST", required=False, default="127.0.0.1"),
        port=int(_read("PORT", required=False, default="8000")),
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Versão cacheada — o .env é lido uma única vez por processo."""
    return load_settings()


def load_trello_credentials(*, env_path: Path | None = None) -> tuple[str, str]:
    """Só as chaves do Trello — usado pelo utilitário de mapeamento de listas,
    que precisa rodar antes de os IDs das listas existirem."""
    load_dotenv(dotenv_path=env_path or ENV_PATH)
    return _read("TRELLO_API_KEY"), _read("TRELLO_TOKEN")
