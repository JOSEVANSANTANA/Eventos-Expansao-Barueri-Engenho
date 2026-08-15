from __future__ import annotations

import pytest
import requests
from conftest import FakeResponse, FakeSession

from cerebro.trello import TrelloClient, TrelloError


def _client(*responses):
    session = FakeSession(*responses)
    return TrelloClient("k", "t", timeout=5, session=session), session


def test_create_card_envia_credenciais_e_campos():
    client, session = _client(
        FakeResponse(200, {"id": "c1", "shortUrl": "https://trello.com/c/x"})
    )

    card = client.create_card("list_1", "Título", "Descrição", due="2026-08-16T15:00:00.000Z")

    assert card["id"] == "c1"
    chamada = session.requests[0]
    assert chamada["method"] == "POST"
    assert chamada["url"].endswith("/cards")
    assert chamada["params"]["key"] == "k"
    assert chamada["params"]["token"] == "t"
    assert chamada["params"]["idList"] == "list_1"
    assert chamada["params"]["name"] == "Título"
    assert chamada["params"]["due"] == "2026-08-16T15:00:00.000Z"


def test_parametros_nulos_nao_sao_enviados():
    client, session = _client(FakeResponse(200, {"id": "c1"}))
    client.create_card("list_1", "Título", "Desc", due=None)
    assert "due" not in session.requests[0]["params"]


def test_401_tem_mensagem_acionavel():
    client, _ = _client(FakeResponse(401, text="unauthorized"))
    with pytest.raises(TrelloError, match="TRELLO_API_KEY"):
        client.create_card("list_1", "Título")


def test_404_aponta_para_o_utilitario_de_listas():
    client, _ = _client(FakeResponse(404, text="not found"))
    with pytest.raises(TrelloError, match="get_trello_lists"):
        client.create_card("list_inexistente", "Título")


def test_erro_generico_inclui_status_e_corpo():
    client, _ = _client(FakeResponse(500, text="boom"))
    with pytest.raises(TrelloError, match="500"):
        client.list_boards()


def test_falha_de_rede_vira_trello_error():
    client, _ = _client(requests.ConnectionError("sem rede"))
    with pytest.raises(TrelloError, match="falha de rede"):
        client.list_boards()


def test_resposta_sem_id_e_rejeitada():
    client, _ = _client(FakeResponse(200, {"erro": "?"}))
    with pytest.raises(TrelloError, match="resposta inesperada"):
        client.create_card("list_1", "Título")


def test_list_lists_usa_filtro_de_abertas():
    client, session = _client(FakeResponse(200, [{"id": "l1", "name": "Ideias"}]))
    listas = client.list_lists("board_1")
    assert listas[0]["name"] == "Ideias"
    assert session.requests[0]["params"]["filter"] == "open"
