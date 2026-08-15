"""Histórico em memória do que o Cérebro processou nesta sessão.

Não é banco de dados: some quando o app fecha. Serve para o painel mostrar o que
acabou de acontecer sem depender de nenhuma infraestrutura extra.
"""

from __future__ import annotations

from collections import deque
from datetime import datetime
from threading import Lock
from typing import Any
from zoneinfo import ZoneInfo

from .models import WebhookMessage, WebhookResponse


class History:
    def __init__(self, capacity: int = 50, timezone: str = "America/Sao_Paulo") -> None:
        self._items: deque[dict[str, Any]] = deque(maxlen=capacity)
        self._lock = Lock()
        self._timezone = timezone

    def _now(self) -> str:
        return datetime.now(ZoneInfo(self._timezone)).strftime("%H:%M:%S")

    def record(self, message: WebhookMessage, response: WebhookResponse) -> None:
        with self._lock:
            self._items.appendleft(
                {
                    "at": self._now(),
                    "text": message.text,
                    "sender": message.sender,
                    "group": message.group,
                    "status": response.status,
                    "action_type": response.action_type.value,
                    "title": response.title,
                    "card_url": response.card_url,
                    "due_date": response.due_date,
                }
            )

    def record_error(self, message: WebhookMessage, stage: str, detail: str) -> None:
        with self._lock:
            self._items.appendleft(
                {
                    "at": self._now(),
                    "text": message.text,
                    "sender": message.sender,
                    "group": message.group,
                    "status": "error",
                    "stage": stage,
                    "detail": detail,
                }
            )

    def items(self) -> list[dict[str, Any]]:
        with self._lock:
            return list(self._items)

    def clear(self) -> None:
        with self._lock:
            self._items.clear()
