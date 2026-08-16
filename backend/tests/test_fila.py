"""O passo que o worker de fila executa quando reprocessa uma mensagem parada."""

from __future__ import annotations

import pytest
from conftest import FakeAnalyzer, FakeTrello, montar_pipeline

from cerebro.db import Store
from cerebro.gemini import GeminiAnalysisError
from cerebro.models import ActionType, Classification
from cerebro.trello import TrelloError
from main import _area_da_linha, _processar_linha

CLASSIFICACAO = Classification(
    action_type=ActionType.TAREFA, title="Gravar vídeos", description="Contexto."
)


@pytest.fixture
def store(tmp_path):
    banco = Store(tmp_path / "fila.db")
    yield banco
    banco.close()


def _pipeline(resultado, trello=None, area=None):
    return montar_pipeline(FakeAnalyzer(resultado), trello or FakeTrello(), area=area)


def _linha(store: Store, area=None) -> dict:
    store.registrar(
        "gravar vídeos no domingo",
        autor="Lívia",
        grupo="EXPANSAO OSASCO",
        area_id=area.id if area else None,
        area_nome=area.nome if area else None,
    )
    return store.pendentes_vencidas()[0]


def test_reprocessamento_bem_sucedido_cria_o_cartao(store, area):
    trello = FakeTrello()
    linha = _linha(store, area)

    _processar_linha(_pipeline(CLASSIFICACAO, trello, area), store, linha)

    assert len(trello.cards) == 1
    item = store.historico()[0]
    assert item["status"] == "criado"
    assert item["card_url"] == "https://trello.com/c/abc123"
    assert store.estatisticas()["pendentes"] == 0


def test_reprocessamento_preserva_autor_e_grupo(store, area):
    trello = FakeTrello()
    _processar_linha(_pipeline(CLASSIFICACAO, trello, area), store, _linha(store, area))

    descricao = trello.cards[0]["desc"]
    assert "Lívia" in descricao
    assert "EXPANSAO OSASCO" in descricao


def test_falha_de_rede_volta_para_a_fila(store, area):
    linha = _linha(store, area)
    pipeline = _pipeline(CLASSIFICACAO, FakeTrello(error=TrelloError("timeout")), area)

    _processar_linha(pipeline, store, linha)

    item = store.historico()[0]
    assert item["status"] == "pendente"   # tenta de novo mais tarde
    assert item["tentativas"] == 1
    assert item["stage"] == "trello"


def test_credencial_invalida_nao_fica_repetindo(store, area):
    """Repetir uma chave errada só queima cota: vira erro definitivo."""
    linha = _linha(store, area)
    pipeline = _pipeline(GeminiAnalysisError("API key not valid"), area=area)

    _processar_linha(pipeline, store, linha)

    assert store.historico()[0]["status"] == "erro"
    assert store.pendentes_vencidas() == []


def test_lista_inexistente_no_trello_nao_fica_repetindo(store, area):
    linha = _linha(store, area)
    pipeline = _pipeline(
        CLASSIFICACAO, FakeTrello(error=TrelloError("recurso não encontrado (404)")), area
    )

    _processar_linha(pipeline, store, linha)

    assert store.historico()[0]["status"] == "erro"


def test_cota_excedida_continua_tentando(store, area):
    """429/5xx são temporários — a mensagem não pode ser descartada."""
    linha = _linha(store, area)
    pipeline = _pipeline(GeminiAnalysisError("429 resource exhausted"), area=area)

    _processar_linha(pipeline, store, linha)

    assert store.historico()[0]["status"] == "pendente"


def test_bate_papo_sai_da_fila_sem_cartao(store, area):
    trello = FakeTrello()
    linha = _linha(store, area)

    _processar_linha(
        _pipeline(Classification(action_type=ActionType.IGNORAR), trello, area), store, linha
    )

    assert store.historico()[0]["status"] == "ignorado"
    assert trello.cards == []
    assert store.estatisticas()["pendentes"] == 0


def test_lista_apagada_mantem_na_fila(store, area):
    """Colunas removidas da área: guarda a mensagem até alguém arrumar."""
    linha = _linha(store, area)
    pipeline = montar_pipeline(FakeAnalyzer(CLASSIFICACAO), FakeTrello(), tarefas="")

    _processar_linha(pipeline, store, linha)

    item = store.historico()[0]
    assert item["status"] == "pendente"
    assert item["stage"] == "config"


# ------------------------------------------------------- resolução da área na fila
def test_area_da_linha_usa_o_id_gravado(store, areas, area):
    outra = areas.criar("Outra", list_ideias="a", list_tarefas="b")
    linha = _linha(store, outra)
    assert _area_da_linha(areas, linha).id == outra.id


def test_area_da_linha_cai_no_vinculo_quando_o_id_sumiu(store, areas, area):
    """Área apagada depois que a mensagem entrou: o vínculo do grupo resolve."""
    fantasma = areas.criar("Temporária", list_ideias="a", list_tarefas="b")
    areas.vincular(area.id, "EXPANSAO OSASCO", "grupo")
    linha = _linha(store, fantasma)
    areas.remover(fantasma.id)

    assert _area_da_linha(areas, linha).id == area.id


def test_area_da_linha_cai_na_padrao(store, areas, area):
    linha = _linha(store)  # sem área gravada, sem vínculo
    assert _area_da_linha(areas, linha).id == area.id
