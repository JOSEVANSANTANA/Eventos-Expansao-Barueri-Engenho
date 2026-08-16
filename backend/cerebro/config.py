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
    # OAuth Secret do Power-Up. Opcional: a API REST usa chave+token; o segredo
    # só entra em fluxos OAuth. Guardado para quem precisar.
    trello_secret: str = ""
    # --- servidor e fila (com padrão: o .env antigo continua válido) ---
    db_path: str = str(BASE_DIR / "dados" / "cerebro.db")
    server_token: str = ""
    fila_intervalo: float = 20.0
    # --- WhatsApp ---
    whatsapp_provider: str = "nenhum"
    whatsapp_api_key: str = ""
    whatsapp_verify_token: str = ""
    whatsapp_app_secret: str = ""
    whatsapp_grupos: tuple[str, ...] = ()
    whatsapp_ignorar_proprias: bool = True

    @property
    def whatsapp_ativo(self) -> bool:
        return self.whatsapp_provider not in ("", "nenhum")


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


def load_settings(
    *,
    env_path: Path | None = None,
    override: bool = True,
    require_lists: bool = False,
) -> Settings:
    """Lê o .env do disco e devolve as configurações já validadas.

    Por padrão os IDs das listas são opcionais: o app precisa subir mesmo sem eles
    para que o painel consiga guiar a configuração no navegador.
    """
    load_dotenv(dotenv_path=env_path or ENV_PATH, override=override)
    return Settings(
        gemini_api_key=_read("GEMINI_API_KEY"),
        gemini_model=_read("GEMINI_MODEL", required=False, default="gemini-flash-latest"),
        trello_api_key=_read("TRELLO_API_KEY"),
        trello_token=_read("TRELLO_TOKEN"),
        trello_secret=_read("TRELLO_SECRET", required=False),
        trello_list_id_ideias=_read("TRELLO_LIST_ID_IDEIAS", required=require_lists),
        trello_list_id_tarefas=_read("TRELLO_LIST_ID_TAREFAS", required=require_lists),
        timezone=_read("TIMEZONE", required=False, default="America/Sao_Paulo"),
        request_timeout=float(_read("REQUEST_TIMEOUT", required=False, default="15")),
        host=_read("HOST", required=False, default="127.0.0.1"),
        port=int(_read("PORT", required=False, default="8000")),
        db_path=_read("DB_PATH", required=False, default=str(BASE_DIR / "dados" / "cerebro.db")),
        server_token=_read("SERVER_TOKEN", required=False),
        fila_intervalo=float(_read("FILA_INTERVALO", required=False, default="20")),
        whatsapp_provider=_read("WHATSAPP_PROVIDER", required=False, default="nenhum").lower(),
        whatsapp_api_key=_read("WHATSAPP_API_KEY", required=False),
        whatsapp_verify_token=_read("WHATSAPP_VERIFY_TOKEN", required=False),
        whatsapp_app_secret=_read("WHATSAPP_APP_SECRET", required=False),
        whatsapp_grupos=_lista(_read("WHATSAPP_GRUPOS", required=False)),
        whatsapp_ignorar_proprias=_booleano(
            _read("WHATSAPP_IGNORAR_PROPRIAS", required=False, default="sim")
        ),
    )


def _lista(valor: str) -> tuple[str, ...]:
    """Converte "Grupo A, Grupo B" em ("Grupo A", "Grupo B")."""
    return tuple(parte.strip() for parte in valor.split(",") if parte.strip())


def _booleano(valor: str) -> bool:
    return valor.strip().lower() in {"1", "sim", "true", "yes", "on"}


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Versão cacheada — o .env é lido uma única vez por processo."""
    return load_settings()


def reload_settings() -> Settings:
    """Relê o .env do disco (usado depois que o painel grava novos IDs de lista)."""
    get_settings.cache_clear()
    return get_settings()


def write_env_values(values: dict[str, str], *, env_path: Path | None = None) -> Path:
    """Atualiza chaves do .env preservando comentários, ordem e demais valores.

    Chaves ainda inexistentes são acrescentadas ao final do arquivo.
    """
    path = env_path or ENV_PATH
    linhas = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    pendentes = dict(values)

    for indice, linha in enumerate(linhas):
        despido = linha.strip()
        if not despido or despido.startswith("#") or "=" not in despido:
            continue
        chave = despido.split("=", 1)[0].strip()
        if chave in pendentes:
            linhas[indice] = f"{chave}={pendentes.pop(chave)}"

    if pendentes:
        if linhas and linhas[-1].strip():
            linhas.append("")
        linhas.extend(f"{chave}={valor}" for chave, valor in pendentes.items())

    path.write_text("\n".join(linhas).rstrip("\n") + "\n", encoding="utf-8")
    return path


def load_trello_credentials(*, env_path: Path | None = None) -> tuple[str, str]:
    """Só as chaves do Trello — usado pelo utilitário de mapeamento de listas,
    que precisa rodar antes de os IDs das listas existirem."""
    load_dotenv(dotenv_path=env_path or ENV_PATH)
    return _read("TRELLO_API_KEY"), _read("TRELLO_TOKEN")
