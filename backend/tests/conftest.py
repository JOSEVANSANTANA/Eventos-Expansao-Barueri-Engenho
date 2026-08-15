from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from cerebro.config import Settings  # noqa: E402
from cerebro.models import Classification, WebhookMessage  # noqa: E402


@pytest.fixture
def settings(tmp_path) -> Settings:
    # db_path aponta para o tmp: nenhum teste pode encostar no banco de produção.
    return Settings(
        db_path=str(tmp_path / "cerebro-teste.db"),
        gemini_api_key="fake-gemini-key",
        gemini_model="gemini-1.5-flash",
        trello_api_key="fake-trello-key",
        trello_token="fake-trello-token",
        trello_list_id_ideias="list_ideias_123",
        trello_list_id_tarefas="list_tarefas_456",
        timezone="America/Sao_Paulo",
        request_timeout=5.0,
        host="127.0.0.1",
        port=8000,
    )


class FakeAnalyzer:
    """Dublê da camada de IA: devolve algo fixo ou levanta o erro combinado."""

    def __init__(self, result: Classification | Exception) -> None:
        self.result = result
        self.calls: list[WebhookMessage] = []

    def analyze(self, message: WebhookMessage) -> Classification:
        self.calls.append(message)
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


class FakeTrello:
    """Dublê do cliente Trello: grava as chamadas em vez de fazer HTTP."""

    def __init__(self, error: Exception | None = None) -> None:
        self.error = error
        self.cards: list[dict[str, Any]] = []
        self.cards_existentes: list[dict[str, Any]] = []

    def list_cards(self, list_id: str, limit: int = 20) -> list[dict[str, Any]]:
        if self.error:
            raise self.error
        return self.cards_existentes[:limit]

    def create_card(
        self, list_id: str, name: str, description: str = "", due: str | None = None, **_: Any
    ) -> dict[str, Any]:
        if self.error:
            raise self.error
        card = {
            "id": f"card_{len(self.cards) + 1}",
            "idList": list_id,
            "name": name,
            "desc": description,
            "due": due,
            "shortUrl": "https://trello.com/c/abc123",
        }
        self.cards.append(card)
        return card


class FakeResponse:
    """Resposta HTTP mínima compatível com o que o TrelloClient consome."""

    def __init__(self, status_code: int = 200, payload: Any = None, text: str = "") -> None:
        self.status_code = status_code
        self._payload = payload
        self.text = text or ""
        self.content = b"{}" if payload is not None else b""

    @property
    def ok(self) -> bool:
        return 200 <= self.status_code < 300

    def json(self) -> Any:
        if self._payload is None:
            raise ValueError("sem corpo JSON")
        return self._payload


class FakeSession:
    """Sessão `requests` falsa que devolve respostas pré-programadas."""

    def __init__(self, *responses: FakeResponse | Exception) -> None:
        self._responses = list(responses)
        self.requests: list[dict[str, Any]] = []
        self.headers: dict[str, str] = {}

    def request(self, method: str, url: str, params=None, timeout=None):
        self.requests.append(
            {"method": method, "url": url, "params": params or {}, "timeout": timeout}
        )
        response = self._responses.pop(0) if self._responses else FakeResponse(200, {})
        if isinstance(response, Exception):
            raise response
        return response
