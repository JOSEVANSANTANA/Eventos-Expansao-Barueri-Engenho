from __future__ import annotations

import pytest
from conftest import FakeAnalyzer, FakeTrello, montar_pipeline

from cerebro.models import ActionType, Classification, WebhookMessage
from cerebro.trello import TrelloError

MENSAGEM = WebhookMessage(
    text=(
        "Pessoal, foi confirmado que haverá ceia na Estadual neste domingo, vamos gravar "
        "vídeos ao final do culto para divulgar a Vigília."
    ),
    sender="Pastor Vando",
    group="EXPANSAO OSASCO",
)


def _pipeline(classificacao, trello=None, **kwargs):
    return montar_pipeline(FakeAnalyzer(classificacao), trello or FakeTrello(), **kwargs)


def test_tarefa_vai_para_a_lista_de_tarefas(area):
    trello = FakeTrello()
    pipeline = _pipeline(
        Classification(
            action_type=ActionType.TAREFA,
            title="Gravar vídeos da Vigília",
            description="Gravação ao final do culto de domingo.",
            due_date="2026-08-16T15:00:00.000Z",
        ),
        trello,
        area=area,
    )

    resposta = pipeline.process(MENSAGEM)

    assert resposta.status == "created"
    assert resposta.action_type is ActionType.TAREFA
    assert resposta.card_url == "https://trello.com/c/abc123"
    assert resposta.area == "EXPANSAO OSASCO"
    assert trello.cards[0]["idList"] == area.list_tarefas
    assert trello.cards[0]["due"] == "2026-08-16T15:00:00.000Z"


def test_ideia_vai_para_a_lista_de_ideias(area):
    trello = FakeTrello()
    pipeline = _pipeline(
        Classification(
            action_type=ActionType.IDEIA,
            title="Referências de motion",
            description="Lívia enviou referências.",
        ),
        trello,
        area=area,
    )

    resposta = pipeline.process(MENSAGEM)

    assert resposta.status == "created"
    assert trello.cards[0]["idList"] == area.list_ideias
    assert trello.cards[0]["due"] is None


def test_areas_diferentes_escrevem_em_listas_diferentes(areas):
    """O ponto do multi-área: a mesma mensagem cai no board de quem a mandou."""
    midia = areas.criar("Mídia", list_ideias="ideias_midia", list_tarefas="tarefas_midia")
    louvor = areas.criar("Louvor", list_ideias="ideias_louvor", list_tarefas="tarefas_louvor")
    classificacao = Classification(
        action_type=ActionType.TAREFA, title="Gravar", description="X"
    )

    trello_midia, trello_louvor = FakeTrello(), FakeTrello()
    _pipeline(classificacao, trello_midia, area=midia).process(MENSAGEM)
    _pipeline(classificacao, trello_louvor, area=louvor).process(MENSAGEM)

    assert trello_midia.cards[0]["idList"] == "tarefas_midia"
    assert trello_louvor.cards[0]["idList"] == "tarefas_louvor"


def test_bate_papo_nao_cria_cartao(area):
    trello = FakeTrello()
    pipeline = _pipeline(Classification(action_type=ActionType.IGNORAR), trello, area=area)

    resposta = pipeline.process(MENSAGEM)

    assert resposta.status == "ignored"
    assert resposta.card_id is None
    assert trello.cards == []


def test_descricao_preserva_mensagem_original_autor_e_area(area):
    trello = FakeTrello()
    pipeline = _pipeline(
        Classification(
            action_type=ActionType.TAREFA,
            title="Gravar vídeos",
            description="Contexto resumido pela IA.",
        ),
        trello,
        area=area,
    )

    pipeline.process(MENSAGEM)
    desc = trello.cards[0]["desc"]

    assert "Contexto resumido pela IA." in desc
    assert "Pastor Vando" in desc
    assert "EXPANSAO OSASCO" in desc
    assert "ceia na Estadual" in desc


def test_erro_do_trello_sobe_para_a_camada_web(area):
    pipeline = _pipeline(
        Classification(action_type=ActionType.TAREFA, title="X", description="Y"),
        FakeTrello(error=TrelloError("500 no Trello")),
        area=area,
    )
    with pytest.raises(TrelloError):
        pipeline.process(MENSAGEM)


def test_lista_nao_configurada_falha_citando_a_area(area):
    pipeline = _pipeline(
        Classification(action_type=ActionType.TAREFA, title="X", description="Y"),
        area=area,
        tarefas="",
    )
    pipeline = montar_pipeline(
        pipeline.analyzer, pipeline.trello,
        ideias=area.list_ideias, tarefas="",
    )
    with pytest.raises(ValueError, match="nenhuma lista configurada"):
        pipeline.process(MENSAGEM)


def test_roteamento_de_listas(area):
    pipeline = _pipeline(Classification(action_type=ActionType.IGNORAR), area=area)
    assert pipeline.list_id_for(ActionType.IDEIA) == area.list_ideias
    assert pipeline.list_id_for(ActionType.TAREFA) == area.list_tarefas
    assert pipeline.list_id_for(ActionType.IGNORAR) is None
