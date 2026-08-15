"""Contratos de entrada/saída e normalização do JSON devolvido pelo Gemini."""

from __future__ import annotations

import re
import unicodedata
from datetime import date, datetime, time, timedelta
from enum import Enum
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, Field, field_validator


class ActionType(str, Enum):
    IDEIA = "ideia"
    TAREFA = "tarefa"
    IGNORAR = "ignorar"


# Sinônimos que o modelo eventualmente devolve no lugar dos rótulos canônicos.
_ACTION_ALIASES = {
    "ideia": ActionType.IDEIA,
    "ideias": ActionType.IDEIA,
    "referencia": ActionType.IDEIA,
    "referencias": ActionType.IDEIA,
    "inspiracao": ActionType.IDEIA,
    "tarefa": ActionType.TAREFA,
    "tarefas": ActionType.TAREFA,
    "acao": ActionType.TAREFA,
    "decisao": ActionType.TAREFA,
    "demanda": ActionType.TAREFA,
    "ignorar": ActionType.IGNORAR,
    "ignore": ActionType.IGNORAR,
    "nenhum": ActionType.IGNORAR,
    "bate-papo": ActionType.IGNORAR,
    "batepapo": ActionType.IGNORAR,
}


def strip_accents(text: str) -> str:
    normalized = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in normalized if not unicodedata.combining(ch))


def normalize_action(raw: Any) -> ActionType:
    """Converte qualquer variação plausível para um dos três rótulos canônicos.

    O que não for reconhecido vira `ignorar`: é melhor perder uma classificação
    duvidosa do que poluir o board com cartões de lixo.
    """
    if isinstance(raw, ActionType):
        return raw
    key = strip_accents(str(raw or "")).strip().lower()
    key = re.sub(r"[\s_]+", "", key)
    return _ACTION_ALIASES.get(key, ActionType.IGNORAR)


_DATE_ONLY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _timezone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def normalize_due_date(raw: Any, *, timezone: str = "America/Sao_Paulo") -> str | None:
    """Normaliza a data devolvida pela IA para ISO 8601 em UTC (formato do Trello).

    Aceita `2026-08-16`, `2026-08-16T19:00`, `2026-08-16T19:00:00-03:00` e a
    variação com `Z`. Datas sem hora viram 12:00 no fuso da equipe — cartão que
    vence "no domingo" não deve aparecer como sábado à noite para quem está em
    UTC-3. Qualquer coisa impossível de interpretar devolve `None`.
    """
    if raw in (None, "", "null", "None"):
        return None
    if isinstance(raw, datetime):
        parsed: datetime | date = raw
    elif isinstance(raw, date):
        parsed = raw
    else:
        text = str(raw).strip()
        if _DATE_ONLY.match(text):
            # `datetime.fromisoformat` aceitaria isto como meia-noite; queremos
            # tratar como dia inteiro e aplicar o horário padrão mais abaixo.
            parsed = date.fromisoformat(text)
        else:
            # Tolera o sufixo Z em qualquer versão do Python.
            candidate = text[:-1] + "+00:00" if text.endswith(("Z", "z")) else text
            try:
                parsed = datetime.fromisoformat(candidate)
            except ValueError:
                try:
                    parsed = date.fromisoformat(candidate[:10])
                except ValueError:
                    return None

    tz = _timezone(timezone)
    if isinstance(parsed, datetime):
        moment = parsed if parsed.tzinfo else parsed.replace(tzinfo=tz)
    else:
        moment = datetime.combine(parsed, time(12, 0), tzinfo=tz)

    utc = moment.astimezone(ZoneInfo("UTC"))
    return utc.strftime("%Y-%m-%dT%H:%M:%S.000Z")


class WebhookMessage(BaseModel):
    """Payload de entrada — uma mensagem capturada do grupo de WhatsApp."""

    text: str = Field(min_length=1, max_length=8000, description="Conteúdo da mensagem.")
    sender: str | None = Field(default=None, max_length=120)
    group: str | None = Field(default=None, max_length=120)

    @field_validator("text")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("text não pode ser vazio")
        return cleaned

    def preview(self, limit: int = 90) -> str:
        flat = " ".join(self.text.split())
        return flat if len(flat) <= limit else flat[: limit - 1] + "…"


class Classification(BaseModel):
    """Saída estruturada do Gemini, já saneada."""

    action_type: ActionType
    title: str = Field(default="", max_length=200)
    description: str = ""
    due_date: str | None = None

    @field_validator("action_type", mode="before")
    @classmethod
    def _normalize_action(cls, value: Any) -> ActionType:
        return normalize_action(value)

    @field_validator("title", "description", mode="before")
    @classmethod
    def _coerce_text(cls, value: Any) -> str:
        if value is None:
            return ""
        return " ".join(str(value).split()) if isinstance(value, str) else str(value)

    @property
    def actionable(self) -> bool:
        return self.action_type is not ActionType.IGNORAR

    @classmethod
    def from_payload(
        cls,
        payload: dict[str, Any],
        *,
        fallback_text: str,
        timezone: str = "America/Sao_Paulo",
    ) -> "Classification":
        """Constrói a classificação a partir do dicionário cru do modelo,
        preenchendo lacunas com a própria mensagem original."""
        instance = cls(
            action_type=payload.get("action_type"),
            title=payload.get("title") or "",
            description=payload.get("description") or "",
            due_date=normalize_due_date(payload.get("due_date"), timezone=timezone),
        )
        if instance.actionable:
            title = instance.title or " ".join(fallback_text.split())[:80]
            description = instance.description or fallback_text
            instance = instance.model_copy(
                update={"title": title[:200], "description": description}
            )
        return instance


class WebhookResponse(BaseModel):
    """Resposta do webhook — o que o Cérebro decidiu e o que foi criado."""

    status: str
    action_type: ActionType
    title: str | None = None
    card_url: str | None = None
    card_id: str | None = None
    due_date: str | None = None
    detail: str | None = None


def today_reference(timezone: str = "America/Sao_Paulo") -> str:
    """Data de hoje, no fuso da equipe, para ancorar expressões relativas
    ('neste domingo', 'amanhã') no prompt do Gemini."""
    now = datetime.now(_timezone(timezone))
    dias = [
        "segunda-feira",
        "terça-feira",
        "quarta-feira",
        "quinta-feira",
        "sexta-feira",
        "sábado",
        "domingo",
    ]
    return f"{now.date().isoformat()} ({dias[now.weekday()]})"


def next_weekday(reference: date, weekday: int) -> date:
    """Próxima ocorrência de um dia da semana (0=segunda … 6=domingo).
    Utilitário auxiliar para testes e para conferência manual de datas."""
    delta = (weekday - reference.weekday()) % 7 or 7
    return reference + timedelta(days=delta)
