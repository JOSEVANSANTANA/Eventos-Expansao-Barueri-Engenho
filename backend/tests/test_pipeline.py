from __future__ import annotations

import pytest
from conftest import FakeAnalyzer, FakeTrello

from cerebro.models import ActionType, Classification, WebhookMessage
from cerebro.pipeline import Pipeline
from cerebro.trello import TrelloError

MENSAGEM = WebhookMessage(
    text=(
        "Pessoal, foi confirmado que haverá ceia na Estadual neste domingo, vamos gravar "
        "vídeos ao final do culto para divulgar a Vigília."
    ),
    sender="Pastor Vando",
    group="EXPANSAO OSASCO",
)


def _pipeline(settings, classification, trello=None):
    return Pipeline(
        settings=settings,
        analyzer=FakeAnalyzer(classification),
        trello=trello or FakeTrello(),
    )


def test_tarefa_vai_para_a_lista_de_tarefas(settings):
    trello = FakeTrello()
    pipeline = _pipeline(
        settings,
        Classification(
            action_type=ActionType.TAREFA,
            title="Gravar vídeos da Vigília",
            description="Gravação ao final do culto de domingo.",
            due_date="2026-08-16T15:00:00.000Z",
        ),
        trello,
    )

    resposta = pipeline.process(MENSAGEM)

    assert resposta.status == "created"
    assert resposta.action_type is ActionType.TAREFA
    assert resposta.card_url == "https://trello.com/c/abc123"
    assert trello.cards[0]["idList"] == settings.trello_list_id_tarefas
    assert trello.cards[0]["due"] == "2026-08-16T15:00:00.000Z"


def test_ideia_vai_para_a_lista_de_ideias(settings):
    trello = FakeTrello()
    pipeline = _pipeline(
        settings,
        Classification(
            action_type=ActionType.IDEIA,
            title="Referências de motion",
            description="Lívia enviou referências.",
        ),
        trello,
    )

    resposta = pipeline.process(MENSAGEM)

    assert resposta.status == "created"
    assert trello.cards[0]["idList"] == settings.trello_list_id_ideias
    assert trello.cards[0]["due"] is None


def test_bate_papo_nao_cria_cartao(settings):
    trello = FakeTrello()
    pipeline = _pipeline(settings, Classification(action_type=ActionType.IGNORAR), trello)

    resposta = pipeline.process(MENSAGEM)

    assert resposta.status == "ignored"
    assert resposta.card_id is None
    assert trello.cards == []


def test_descricao_preserva_mensagem_original_e_autor(settings):
    trello = FakeTrello()
    pipeline = _pipeline(
        settings,
        Classification(
            action_type=ActionType.TAREFA,
            title="Gravar vídeos",
            description="Contexto resumido pela IA.",
        ),
        trello,
    )

    pipeline.process(MENSAGEM)
    desc = trello.cards[0]["desc"]

    assert "Contexto resumido pela IA." in desc
    assert "Pastor Vando" in desc
    assert "EXPANSAO OSASCO" in desc
    assert "ceia na Estadual" in desc


def test_erro_do_trello_sobe_para_a_camada_web(settings):
    pipeline = _pipeline(
        settings,
        Classification(action_type=ActionType.TAREFA, title="X", description="Y"),
        FakeTrello(error=TrelloError("500 no Trello")),
    )
    with pytest.raises(TrelloError):
        pipeline.process(MENSAGEM)


def test_lista_nao_configurada_falha_explicitamente(settings):
    sem_lista = type(settings)(**{**settings.__dict__, "trello_list_id_tarefas": ""})
    pipeline = _pipeline(
        sem_lista, Classification(action_type=ActionType.TAREFA, title="X", description="Y")
    )
    with pytest.raises(ValueError, match="nenhuma lista configurada"):
        pipeline.process(MENSAGEM)


def test_roteamento_de_listas(settings):
    pipeline = _pipeline(settings, Classification(action_type=ActionType.IGNORAR))
    assert pipeline.list_id_for(ActionType.IDEIA) == settings.trello_list_id_ideias
    assert pipeline.list_id_for(ActionType.TAREFA) == settings.trello_list_id_tarefas
    assert pipeline.list_id_for(ActionType.IGNORAR) is None
