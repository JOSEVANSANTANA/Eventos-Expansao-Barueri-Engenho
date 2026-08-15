from __future__ import annotations

import pytest
from conftest import FakeAnalyzer, FakeTrello
from fastapi.testclient import TestClient

from cerebro.gemini import GeminiAnalysisError
from cerebro.models import ActionType, Classification
from cerebro.pipeline import Pipeline
from cerebro.trello import TrelloError
from main import app, get_pipeline

PAYLOAD = {
    "text": (
        "Pessoal, foi confirmado que haverá ceia na Estadual neste domingo, vamos gravar "
        "vídeos ao final do culto para divulgar a Vigília. Lívia já mandou as referências, "
        "Letícia vai fazer o roteiro hoje."
    )
}


@pytest.fixture
def client(settings):
    """TestClient com o pipeline substituído — nenhuma chamada externa é feita."""
    fakes: dict = {}

    def _make(resultado, trello=None):
        trello = trello or FakeTrello()
        fakes["trello"] = trello
        app.dependency_overrides[get_pipeline] = lambda: Pipeline(
            settings=settings, analyzer=FakeAnalyzer(resultado), trello=trello
        )
        return TestClient(app), fakes

    yield _make
    app.dependency_overrides.clear()


def test_webhook_cria_cartao_de_tarefa(client):
    http, fakes = client(
        Classification(
            action_type=ActionType.TAREFA,
            title="Gravar vídeos da Vigília",
            description="Gravação ao final do culto.",
            due_date="2026-08-16T15:00:00.000Z",
        )
    )

    resposta = http.post("/webhook", json=PAYLOAD)

    assert resposta.status_code == 200
    corpo = resposta.json()
    assert corpo["status"] == "created"
    assert corpo["action_type"] == "tarefa"
    assert corpo["card_url"] == "https://trello.com/c/abc123"
    assert len(fakes["trello"].cards) == 1


def test_webhook_ignora_bate_papo(client):
    http, fakes = client(Classification(action_type=ActionType.IGNORAR))

    resposta = http.post("/webhook", json={"text": "kkkkk boa demais"})

    assert resposta.status_code == 200
    assert resposta.json()["status"] == "ignored"
    assert fakes["trello"].cards == []


def test_webhook_rejeita_payload_sem_texto(client):
    http, _ = client(Classification(action_type=ActionType.IGNORAR))
    assert http.post("/webhook", json={}).status_code == 422
    assert http.post("/webhook", json={"text": "  "}).status_code == 422


def test_falha_do_gemini_retorna_502(client):
    http, _ = client(GeminiAnalysisError("cota excedida"))

    resposta = http.post("/webhook", json=PAYLOAD)

    assert resposta.status_code == 502
    assert resposta.json()["stage"] == "gemini"


def test_falha_do_trello_retorna_502(client):
    http, _ = client(
        Classification(action_type=ActionType.TAREFA, title="X", description="Y"),
        trello=FakeTrello(error=TrelloError("401 unauthorized")),
    )

    resposta = http.post("/webhook", json=PAYLOAD)

    assert resposta.status_code == 502
    assert resposta.json()["stage"] == "trello"


def test_health_endpoint():
    resposta = TestClient(app).get("/health")
    assert resposta.status_code == 200
    assert resposta.json()["status"] == "ok"


def test_raiz_identifica_o_servico():
    corpo = TestClient(app).get("/").json()
    assert corpo["service"] == "cerebro-de-operacoes"
