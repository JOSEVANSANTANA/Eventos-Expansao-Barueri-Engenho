"""O passo que o worker de fila executa quando reprocessa uma mensagem parada."""

from __future__ import annotations

import pytest
from conftest import FakeAnalyzer, FakeTrello

from cerebro.db import Store
from cerebro.gemini import GeminiAnalysisError
from cerebro.models import ActionType, Classification
from cerebro.pipeline import Pipeline
from cerebro.trello import TrelloError
from main import _processar_linha

CLASSIFICACAO = Classification(
    action_type=ActionType.TAREFA, title="Gravar vídeos", description="Contexto."
)


@pytest.fixture
def store(tmp_path):
    banco = Store(tmp_path / "fila.db")
    yield banco
    banco.close()


def _pipeline(settings, resultado, trello=None):
    return Pipeline(
        settings=settings, analyzer=FakeAnalyzer(resultado), trello=trello or FakeTrello()
    )


def _linha(store: Store) -> dict:
    store.registrar("gravar vídeos no domingo", autor="Lívia", grupo="EXPANSAO OSASCO")
    return store.pendentes_vencidas()[0]


def test_reprocessamento_bem_sucedido_cria_o_cartao(settings, store):
    trello = FakeTrello()
    linha = _linha(store)

    _processar_linha(_pipeline(settings, CLASSIFICACAO, trello), store, linha)

    assert len(trello.cards) == 1
    item = store.historico()[0]
    assert item["status"] == "criado"
    assert item["card_url"] == "https://trello.com/c/abc123"
    assert store.estatisticas()["pendentes"] == 0


def test_reprocessamento_preserva_autor_e_grupo(settings, store):
    trello = FakeTrello()
    _processar_linha(_pipeline(settings, CLASSIFICACAO, trello), store, _linha(store))

    descricao = trello.cards[0]["desc"]
    assert "Lívia" in descricao
    assert "EXPANSAO OSASCO" in descricao


def test_falha_de_rede_volta_para_a_fila(settings, store):
    linha = _linha(store)
    pipeline = _pipeline(settings, CLASSIFICACAO, FakeTrello(error=TrelloError("timeout")))

    _processar_linha(pipeline, store, linha)

    item = store.historico()[0]
    assert item["status"] == "pendente"   # tenta de novo mais tarde
    assert item["tentativas"] == 1
    assert item["stage"] == "trello"


def test_credencial_invalida_nao_fica_repetindo(settings, store):
    """Repetir uma chave errada só queima cota: vira erro definitivo."""
    linha = _linha(store)
    pipeline = _pipeline(settings, GeminiAnalysisError("API key not valid"))

    _processar_linha(pipeline, store, linha)

    assert store.historico()[0]["status"] == "erro"
    assert store.pendentes_vencidas() == []


def test_lista_inexistente_no_trello_nao_fica_repetindo(settings, store):
    linha = _linha(store)
    pipeline = _pipeline(
        settings, CLASSIFICACAO, FakeTrello(error=TrelloError("recurso não encontrado (404)"))
    )

    _processar_linha(pipeline, store, linha)

    assert store.historico()[0]["status"] == "erro"


def test_cota_excedida_continua_tentando(settings, store):
    """429/5xx são temporários — a mensagem não pode ser descartada."""
    linha = _linha(store)
    pipeline = _pipeline(settings, GeminiAnalysisError("429 resource exhausted"))

    _processar_linha(pipeline, store, linha)

    assert store.historico()[0]["status"] == "pendente"


def test_bate_papo_sai_da_fila_sem_cartao(settings, store):
    trello = FakeTrello()
    linha = _linha(store)

    _processar_linha(
        _pipeline(settings, Classification(action_type=ActionType.IGNORAR), trello), store, linha
    )

    assert store.historico()[0]["status"] == "ignorado"
    assert trello.cards == []
    assert store.estatisticas()["pendentes"] == 0


def test_erro_de_configuracao_mantem_na_fila(settings, store):
    """Listas apagadas do .env: guarda a mensagem até alguém arrumar."""
    sem_lista = type(settings)(**{**settings.__dict__, "trello_list_id_tarefas": ""})
    linha = _linha(store)

    _processar_linha(_pipeline(sem_lista, CLASSIFICACAO), store, linha)

    item = store.historico()[0]
    assert item["status"] == "pendente"
    assert item["stage"] == "config"
