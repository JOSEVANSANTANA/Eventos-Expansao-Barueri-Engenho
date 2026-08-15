"""Cliente HTTP do Trello — leitura de boards/listas e criação de cartões."""

from __future__ import annotations

from typing import Any

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

BASE_URL = "https://api.trello.com/1"


class TrelloError(RuntimeError):
    """Erro de comunicação ou de negócio vindo da API do Trello."""


def build_session(*, retries: int = 3) -> requests.Session:
    """Sessão com pool de conexões e retentativa para 429/5xx."""
    session = requests.Session()
    policy = Retry(
        total=retries,
        backoff_factor=0.8,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset({"GET", "POST"}),
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=policy)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    session.headers.update({"Accept": "application/json"})
    return session


class TrelloClient:
    def __init__(
        self,
        api_key: str,
        token: str,
        *,
        timeout: float = 15.0,
        session: requests.Session | None = None,
    ) -> None:
        self._auth = {"key": api_key, "token": token}
        self._timeout = timeout
        self._session = session or build_session()

    # ------------------------------------------------------------------ core
    def _request(
        self, method: str, path: str, params: dict[str, Any] | None = None
    ) -> Any:
        query = {**self._auth, **{k: v for k, v in (params or {}).items() if v is not None}}
        url = f"{BASE_URL}{path}"
        try:
            response = self._session.request(
                method, url, params=query, timeout=self._timeout
            )
        except requests.RequestException as exc:
            raise TrelloError(f"falha de rede ao chamar {method} {path}: {exc}") from exc

        if response.status_code == 401:
            raise TrelloError(
                "Trello recusou as credenciais (401). Confira TRELLO_API_KEY/TRELLO_TOKEN."
            )
        if response.status_code == 404:
            raise TrelloError(
                f"recurso não encontrado (404) em {path}. "
                "Confira os IDs das listas no .env — rode `python get_trello_lists.py`."
            )
        if not response.ok:
            raise TrelloError(
                f"Trello respondeu {response.status_code} em {path}: "
                f"{response.text[:300]}"
            )
        if not response.content:
            return None
        try:
            return response.json()
        except ValueError as exc:
            raise TrelloError(f"resposta não-JSON do Trello em {path}") from exc

    # ------------------------------------------------------------- consultas
    def me(self) -> dict[str, Any]:
        return self._request("GET", "/members/me", {"fields": "id,username,fullName"})

    def list_boards(self) -> list[dict[str, Any]]:
        return self._request(
            "GET", "/members/me/boards", {"fields": "id,name,closed,url", "filter": "open"}
        ) or []

    def list_lists(self, board_id: str) -> list[dict[str, Any]]:
        return self._request(
            "GET", f"/boards/{board_id}/lists", {"fields": "id,name,closed", "filter": "open"}
        ) or []

    def get_list(self, list_id: str) -> dict[str, Any]:
        return self._request("GET", f"/lists/{list_id}", {"fields": "id,name,idBoard"})

    # ------------------------------------------------------------------ ação
    def create_card(
        self,
        list_id: str,
        name: str,
        description: str = "",
        due: str | None = None,
        *,
        position: str = "top",
    ) -> dict[str, Any]:
        """Cria um cartão e devolve o objeto criado (com `id` e `shortUrl`)."""
        card = self._request(
            "POST",
            "/cards",
            {
                "idList": list_id,
                "name": name,
                "desc": description,
                "due": due,
                "pos": position,
            },
        )
        if not isinstance(card, dict) or "id" not in card:
            raise TrelloError(f"resposta inesperada ao criar cartão: {card!r}")
        return card
