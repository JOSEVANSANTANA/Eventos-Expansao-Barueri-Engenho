"""Testes de rota para WhatsApp, estúdio criativo e o token de acesso em rede."""

from __future__ import annotations

import dataclasses

import pytest
from conftest import FakeAnalyzer, FakeTrello
from fastapi.testclient import TestClient

from cerebro.db import Store
from cerebro.estudio import Ideia
from cerebro.models import ActionType, Classification
from cerebro.pipeline import Pipeline
from main import (
    app,
    get_estudio,
    get_pipeline,
    get_pipeline_opcional,
    get_store,
    trello_client,
)

CLASSIFICACAO = Classification(
    action_type=ActionType.TAREFA, title="Gravar vídeos", description="Contexto."
)


def evolution_payload(texto="Vamos gravar vídeos no domingo", id_="WA-1"):
    return {
        "event": "messages.upsert",
        "data": {
            "key": {"remoteJid": "1203@g.us", "fromMe": False, "id": id_},
            "pushName": "Lívia",
            "groupName": "EXPANSAO OSASCO",
            "message": {"conversation": texto},
        },
    }


@pytest.fixture
def ambiente(settings, tmp_path):
    """Monta o app com estado de produção simulado e dependências substituídas."""
    criados: dict = {}

    def _montar(**mudancas):
        config = dataclasses.replace(settings, **mudancas)
        store = Store(tmp_path / f"rotas-{len(criados)}.db", timezone=config.timezone)
        trello = FakeTrello()
        criados["store"] = store
        criados["trello"] = trello
        criados["settings"] = config

        pronto = bool(config.trello_list_id_ideias and config.trello_list_id_tarefas)
        pipeline = Pipeline(
            settings=config, analyzer=FakeAnalyzer(CLASSIFICACAO), trello=trello
        )

        app.state.settings = config
        app.state.config_error = None
        app.dependency_overrides[get_store] = lambda: store
        app.dependency_overrides[trello_client] = lambda: trello
        app.dependency_overrides[get_pipeline] = lambda: pipeline
        app.dependency_overrides[get_pipeline_opcional] = lambda: pipeline if pronto else None
        return TestClient(app), criados

    yield _montar

    app.dependency_overrides.clear()
    app.state.settings = None
    if "store" in criados:
        criados["store"].close()


# ------------------------------------------------------------------- whatsapp
def test_whatsapp_desligado_responde_409(ambiente):
    http, _ = ambiente(whatsapp_provider="nenhum")
    resposta = http.post("/webhook/whatsapp", json=evolution_payload())
    assert resposta.status_code == 409
    assert resposta.json()["stage"] == "config"


def test_whatsapp_cria_cartao_a_partir_do_grupo(ambiente):
    http, criados = ambiente(whatsapp_provider="evolution")

    resposta = http.post("/webhook/whatsapp", json=evolution_payload())

    assert resposta.status_code == 200
    assert resposta.json()["status"] == "created"
    assert len(criados["trello"].cards) == 1
    item = criados["store"].historico()[0]
    assert item["origem"] == "whatsapp"
    assert item["autor"] == "Lívia"


def test_whatsapp_nao_processa_a_mesma_mensagem_duas_vezes(ambiente):
    http, criados = ambiente(whatsapp_provider="evolution")

    http.post("/webhook/whatsapp", json=evolution_payload(id_="WA-9"))
    segunda = http.post("/webhook/whatsapp", json=evolution_payload(id_="WA-9"))

    assert segunda.json()["status"] == "duplicate"
    assert len(criados["trello"].cards) == 1


def test_whatsapp_apikey_errada_e_recusada(ambiente):
    http, criados = ambiente(whatsapp_provider="evolution", whatsapp_api_key="segredo")

    resposta = http.post(
        "/webhook/whatsapp", json=evolution_payload(), headers={"apikey": "errada"}
    )

    assert resposta.status_code == 401
    assert criados["trello"].cards == []


def test_whatsapp_apikey_correta_passa(ambiente):
    http, _ = ambiente(whatsapp_provider="evolution", whatsapp_api_key="segredo")
    resposta = http.post(
        "/webhook/whatsapp", json=evolution_payload(), headers={"apikey": "segredo"}
    )
    assert resposta.status_code == 200


def test_whatsapp_mensagem_propria_e_descartada(ambiente):
    http, criados = ambiente(whatsapp_provider="evolution")
    payload = evolution_payload()
    payload["data"]["key"]["fromMe"] = True

    resposta = http.post("/webhook/whatsapp", json=payload)

    assert resposta.json()["status"] == "skipped"
    assert criados["store"].estatisticas()["total"] == 0


def test_whatsapp_sem_listas_configuradas_enfileira(ambiente):
    """Chegou mensagem antes de o Trello estar pronto: guarda, não perde."""
    http, criados = ambiente(
        whatsapp_provider="evolution", trello_list_id_tarefas="", trello_list_id_ideias=""
    )

    resposta = http.post("/webhook/whatsapp", json=evolution_payload())

    assert resposta.json()["status"] == "queued"
    assert criados["store"].estatisticas()["pendentes"] == 1


def test_verificacao_da_meta_devolve_o_challenge(ambiente):
    http, _ = ambiente(whatsapp_provider="meta", whatsapp_verify_token="token-de-verificacao")

    resposta = http.get(
        "/webhook/whatsapp",
        params={
            "hub.mode": "subscribe",
            "hub.verify_token": "token-de-verificacao",
            "hub.challenge": "1234567",
        },
    )

    assert resposta.status_code == 200
    assert resposta.text == "1234567"


def test_verificacao_da_meta_recusa_token_errado(ambiente):
    http, _ = ambiente(whatsapp_provider="meta", whatsapp_verify_token="certo")
    resposta = http.get(
        "/webhook/whatsapp",
        params={"hub.mode": "subscribe", "hub.verify_token": "errado", "hub.challenge": "1"},
    )
    assert resposta.status_code == 403


# -------------------------------------------------------------------- estúdio
class FakeEstudio:
    def __init__(self) -> None:
        self.pedidos: list[tuple] = []

    def gerar_ideias(self, tema, *, quantidade=5, contexto=None):
        self.pedidos.append((tema, quantidade, tuple(contexto or ())))
        return [
            Ideia(
                title="Série de reels com testemunhos",
                description="Três cortes verticais.",
                formato="Reels",
                esforco="baixo",
                due_date=None,
            )
        ]

    def organizar(self, ideias, tarefas):
        self.pedidos.append(("organizar", len(ideias), len(tarefas)))
        return {"resumo": "Board saudável.", "prioridades": [], "duplicatas": [],
                "lacunas": [], "proximos_passos": []}


@pytest.fixture
def com_estudio(ambiente):
    def _montar(**mudancas):
        http, criados = ambiente(**mudancas)
        estudio = FakeEstudio()
        criados["estudio"] = estudio
        app.dependency_overrides[get_estudio] = lambda: estudio
        return http, criados

    return _montar


def test_gerar_ideias_usa_o_board_como_contexto(com_estudio):
    http, criados = com_estudio()
    criados["trello"].cards_existentes = []

    resposta = http.post("/api/estudio/ideias", json={"tema": "Vigília", "quantidade": 3})

    assert resposta.status_code == 200
    corpo = resposta.json()
    assert corpo["tema"] == "Vigília"
    assert corpo["ideias"][0]["formato"] == "Reels"
    assert criados["estudio"].pedidos[0][1] == 3


def test_gerar_ideias_valida_a_entrada(com_estudio):
    http, _ = com_estudio()
    assert http.post("/api/estudio/ideias", json={"tema": "x"}).status_code == 422
    assert http.post(
        "/api/estudio/ideias", json={"tema": "Vigília", "quantidade": 50}
    ).status_code == 422


def test_criar_cartoes_a_partir_das_ideias_aprovadas(com_estudio):
    http, criados = com_estudio()

    resposta = http.post(
        "/api/estudio/criar-cartoes",
        json={
            "destino": "ideias",
            "ideias": [
                {"title": "Série de reels", "description": "Três cortes.",
                 "formato": "Reels", "esforco": "baixo"}
            ],
        },
    )

    assert resposta.status_code == 200
    assert resposta.json()["cartoes"][0]["url"] == "https://trello.com/c/abc123"
    card = criados["trello"].cards[0]
    assert card["idList"] == criados["settings"].trello_list_id_ideias
    assert "**Formato:** Reels" in card["desc"]


def test_criar_cartoes_aceita_destino_tarefas(com_estudio):
    http, criados = com_estudio()
    http.post(
        "/api/estudio/criar-cartoes",
        json={"destino": "tarefas", "ideias": [{"title": "Roteiro", "description": ""}]},
    )
    assert criados["trello"].cards[0]["idList"] == criados["settings"].trello_list_id_tarefas


def test_criar_cartoes_rejeita_destino_invalido(com_estudio):
    http, _ = com_estudio()
    resposta = http.post(
        "/api/estudio/criar-cartoes",
        json={"destino": "arquivados", "ideias": [{"title": "X"}]},
    )
    assert resposta.status_code == 422


def test_organizar_le_as_duas_colunas(com_estudio):
    http, criados = com_estudio()
    resposta = http.post("/api/estudio/organizar")
    assert resposta.status_code == 200
    assert resposta.json()["resumo"] == "Board saudável."


# ---------------------------------------------------------------------- token
def test_sem_token_configurado_o_acesso_e_livre(ambiente):
    http, _ = ambiente(server_token="")
    assert http.get("/api/status").status_code == 200


def test_com_token_o_acesso_remoto_e_barrado(ambiente):
    http, _ = ambiente(server_token="senha-da-equipe")
    resposta = http.get("/api/status")
    assert resposta.status_code == 401
    assert resposta.json()["stage"] == "auth"


def test_token_correto_no_cabecalho_libera(ambiente):
    http, _ = ambiente(server_token="senha-da-equipe")
    resposta = http.get("/api/status", headers={"X-Cerebro-Token": "senha-da-equipe"})
    assert resposta.status_code == 200


def test_token_correto_na_query_libera(ambiente):
    http, _ = ambiente(server_token="senha-da-equipe")
    assert http.get("/api/status?token=senha-da-equipe").status_code == 200


def test_rotas_livres_continuam_abertas_com_token(ambiente):
    """O painel e o /health precisam abrir para a página conseguir pedir o token."""
    http, _ = ambiente(server_token="senha-da-equipe")
    assert http.get("/health").status_code == 200
    assert http.get("/").status_code == 200


def test_webhook_do_whatsapp_nao_usa_o_token_do_painel(ambiente):
    """O provedor externo autentica pela apikey/assinatura, não pelo token da equipe."""
    http, _ = ambiente(server_token="senha-da-equipe", whatsapp_provider="evolution")
    resposta = http.post("/webhook/whatsapp", json=evolution_payload(id_="WA-TOKEN"))
    assert resposta.status_code == 200
