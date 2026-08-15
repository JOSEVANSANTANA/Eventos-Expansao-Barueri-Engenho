from __future__ import annotations

import pytest
from conftest import FakeAnalyzer, FakeTrello
from fastapi.testclient import TestClient

from cerebro.db import Store
from cerebro.gemini import GeminiAnalysisError
from cerebro.models import ActionType, Classification
from cerebro.pipeline import Pipeline
from cerebro.trello import TrelloError
from main import app, get_pipeline, get_store

PAYLOAD = {
    "text": (
        "Pessoal, foi confirmado que haverá ceia na Estadual neste domingo, vamos gravar "
        "vídeos ao final do culto para divulgar a Vigília. Lívia já mandou as referências, "
        "Letícia vai fazer o roteiro hoje."
    )
}


@pytest.fixture
def client(settings, tmp_path):
    """TestClient com pipeline e banco substituídos — nenhuma chamada externa."""
    fakes: dict = {}

    def _make(resultado, trello=None):
        trello = trello or FakeTrello()
        store = Store(tmp_path / "teste.db", timezone=settings.timezone)
        fakes["trello"] = trello
        fakes["store"] = store
        app.dependency_overrides[get_pipeline] = lambda: Pipeline(
            settings=settings, analyzer=FakeAnalyzer(resultado), trello=trello
        )
        app.dependency_overrides[get_store] = lambda: store
        return TestClient(app), fakes

    yield _make
    app.dependency_overrides.clear()
    if "store" in fakes:
        fakes["store"].close()


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
        trello=FakeTrello(error=TrelloError("timeout na rede")),
    )

    resposta = http.post("/webhook", json=PAYLOAD)

    assert resposta.status_code == 502
    assert resposta.json()["stage"] == "trello"


def test_falha_deixa_a_mensagem_na_fila(client):
    """O ponto do modo offline: falhou, mas a mensagem não se perdeu."""
    http, fakes = client(
        Classification(action_type=ActionType.TAREFA, title="X", description="Y"),
        trello=FakeTrello(error=TrelloError("timeout na rede")),
    )

    http.post("/webhook", json=PAYLOAD)

    assert fakes["store"].estatisticas()["pendentes"] == 1
    assert len(fakes["store"].pendentes_vencidas()) == 0  # aguardando o backoff


def test_health_endpoint():
    resposta = TestClient(app).get("/health")
    assert resposta.status_code == 200
    assert resposta.json()["status"] == "ok"


def test_raiz_serve_o_painel():
    resposta = TestClient(app).get("/")
    assert resposta.status_code == 200
    assert "Cérebro de Operações" in resposta.text


def test_api_info_identifica_o_servico():
    corpo = TestClient(app).get("/api/info").json()
    assert corpo["service"] == "cerebro-de-operacoes"


def test_status_sem_configuracao_nao_quebra():
    """O painel precisa carregar mesmo com o .env pela metade."""
    corpo = TestClient(app).get("/api/status").json()
    assert corpo["ready"] is False
    assert corpo["lists"] == {"ideias": None, "tarefas": None}
    assert corpo["whatsapp"]["ativo"] is False


def test_webhook_sem_configuracao_responde_409():
    """Sem listas escolhidas, a resposta orienta em vez de estourar."""
    resposta = TestClient(app).post("/webhook", json=PAYLOAD)
    assert resposta.status_code == 409
    assert resposta.json()["stage"] == "config"


def test_historico_registra_o_que_foi_criado(client):
    http, _ = client(
        Classification(action_type=ActionType.TAREFA, title="Gravar vídeos", description="Y")
    )
    http.post("/webhook", json=PAYLOAD)

    itens = http.get("/api/history").json()
    assert len(itens) == 1
    assert itens[0]["status"] == "criado"
    assert itens[0]["titulo"] == "Gravar vídeos"
    assert itens[0]["origem"] == "painel"


def test_historico_registra_falha_do_gemini(client):
    http, _ = client(GeminiAnalysisError("cota excedida"))
    http.post("/webhook", json=PAYLOAD)

    itens = http.get("/api/history").json()
    assert itens[0]["status"] == "pendente"  # vai voltar pela fila
    assert itens[0]["stage"] == "gemini"


def test_limpar_historico_preserva_a_fila(client):
    http, fakes = client(
        Classification(action_type=ActionType.TAREFA, title="Feito", description="Y")
    )
    http.post("/webhook", json=PAYLOAD)
    fakes["store"].registrar("mensagem que ficou pendente", origem="painel")

    resposta = http.delete("/api/history")

    assert resposta.json()["removidos"] == 1
    assert fakes["store"].estatisticas()["pendentes"] == 1
