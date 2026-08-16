"""Rotas: áreas, vínculos, chaves, WhatsApp (com comandos), estúdio e token."""

from __future__ import annotations

import dataclasses

import pytest
from conftest import FakeAnalyzer, FakeTrello
from fastapi.testclient import TestClient

from cerebro.db import Store
from cerebro.estudio import Ideia
from cerebro.models import ActionType, Classification
from cerebro.pipeline import Pipeline
from cerebro.workspaces import AreaStore
from main import app, get_areas, get_estudio, get_store

CLASSIFICACAO = Classification(
    action_type=ActionType.TAREFA, title="Gravar vídeos", description="Contexto."
)


def evolution_payload(texto="Vamos gravar vídeos no domingo", id_="WA-1",
                      grupo="EXPANSAO OSASCO"):
    return {
        "event": "messages.upsert",
        "data": {
            "key": {"remoteJid": "1203@g.us", "fromMe": False, "id": id_},
            "pushName": "Lívia",
            "groupName": grupo,
            "message": {"conversation": texto},
        },
    }


@pytest.fixture
def ambiente(settings, tmp_path, monkeypatch):
    """App com estado de produção simulado e dependências substituídas."""
    criados: dict = {}

    def _montar(**mudancas):
        config = dataclasses.replace(settings, **mudancas)
        store = Store(tmp_path / "rotas.db", timezone=config.timezone)
        areas = AreaStore(tmp_path / "rotas.db", timezone=config.timezone)
        trello = FakeTrello()
        criados.update(store=store, areas=areas, trello=trello, settings=config)

        # Toda montagem de pipeline vira o dublê — nada de rede nos testes.
        monkeypatch.setattr(
            "main.build_pipeline",
            lambda cfg, area: Pipeline(
                analyzer=FakeAnalyzer(CLASSIFICACAO),
                trello=trello,
                list_ideias=area.list_ideias,
                list_tarefas=area.list_tarefas,
                area_nome=area.nome,
                area_id=area.id,
            ),
        )
        monkeypatch.setattr("main.trello_da_area", lambda request, area: trello)

        app.state.settings = config
        app.state.config_error = None
        app.state.pipelines = {}
        # Em produção o lifespan preenche o state; aqui fazemos o mesmo para as
        # rotas que leem dele (como /api/status) enxergarem os bancos de teste.
        app.state.store = store
        app.state.areas = areas
        app.dependency_overrides[get_store] = lambda: store
        app.dependency_overrides[get_areas] = lambda: areas
        return TestClient(app), criados

    yield _montar

    app.dependency_overrides.clear()
    app.state.settings = None
    app.state.pipelines = {}
    app.state.store = None
    app.state.areas = None
    for chave in ("store", "areas"):
        if chave in criados:
            criados[chave].close()


def _area_pronta(criados, nome="EXPANSAO OSASCO", **campos):
    return criados["areas"].criar(
        nome,
        list_ideias=campos.get("ideias", "list_ideias_123"),
        list_tarefas=campos.get("tarefas", "list_tarefas_456"),
    )


# ---------------------------------------------------------------------- áreas
def test_criar_area_pelo_painel(ambiente):
    http, _ = ambiente()

    resposta = http.post("/api/areas", json={"nome": "Mídia", "list_ideias": "a",
                                             "list_tarefas": "b"})

    assert resposta.status_code == 201
    corpo = resposta.json()
    assert corpo["nome"] == "Mídia"
    assert corpo["padrao"] is True   # primeira área
    assert corpo["pronta"] is True


def test_criar_area_com_credencial_propria(ambiente):
    """Cada área de trabalho do Trello pode ter chave própria."""
    http, criados = ambiente()

    resposta = http.post(
        "/api/areas",
        json={"nome": "Outra Org", "trello_key": "chave-2", "trello_token": "token-2",
              "trello_secret": "segredo-2", "list_ideias": "a", "list_tarefas": "b"},
    )

    assert resposta.status_code == 201
    assert resposta.json()["credencial_propria"] is True
    # O token não volta no JSON da listagem.
    assert "trello_token" not in resposta.json()
    guardada = criados["areas"].obter(resposta.json()["id"])
    assert guardada.trello_token == "token-2"
    assert guardada.trello_secret == "segredo-2"


def test_nome_repetido_responde_400(ambiente):
    http, _ = ambiente()
    http.post("/api/areas", json={"nome": "Mídia"})
    resposta = http.post("/api/areas", json={"nome": "mídia"})
    assert resposta.status_code == 400
    assert resposta.json()["stage"] == "areas"


def test_editar_e_remover_area(ambiente):
    http, _ = ambiente()
    area_id = http.post("/api/areas", json={"nome": "Mídia"}).json()["id"]

    editada = http.patch(f"/api/areas/{area_id}", json={"nome": "Mídia e Vídeo"})
    assert editada.json()["nome"] == "Mídia e Vídeo"

    assert http.delete(f"/api/areas/{area_id}").status_code == 200
    assert http.get("/api/areas").json() == []


def test_definir_area_padrao(ambiente):
    http, _ = ambiente()
    primeira = http.post("/api/areas", json={"nome": "Mídia"}).json()["id"]
    segunda = http.post("/api/areas", json={"nome": "Louvor"}).json()["id"]

    http.post(f"/api/areas/{segunda}/padrao")

    por_id = {a["id"]: a for a in http.get("/api/areas").json()}
    assert por_id[segunda]["padrao"] is True
    assert por_id[primeira]["padrao"] is False


# -------------------------------------------------------------------- vínculos
def test_vincular_grupo_pelo_painel(ambiente):
    http, _ = ambiente()
    area_id = http.post("/api/areas", json={"nome": "Mídia"}).json()["id"]

    criado = http.post(f"/api/areas/{area_id}/vinculos",
                       json={"identificador": "EXPANSAO OSASCO", "tipo": "grupo"})

    assert criado.status_code == 201
    lista = http.get(f"/api/areas/{area_id}/vinculos").json()
    assert [v["identificador"] for v in lista] == ["EXPANSAO OSASCO"]


def test_remover_vinculo_pelo_painel(ambiente):
    http, _ = ambiente()
    area_id = http.post("/api/areas", json={"nome": "Mídia"}).json()["id"]
    vinculo = http.post(f"/api/areas/{area_id}/vinculos",
                        json={"identificador": "GRUPO"}).json()

    assert http.delete(f"/api/vinculos/{vinculo['id']}").status_code == 200
    assert http.get(f"/api/areas/{area_id}/vinculos").json() == []


def test_status_lista_areas_com_seus_vinculos(ambiente):
    http, _ = ambiente()
    area_id = http.post("/api/areas", json={"nome": "Mídia", "list_ideias": "a",
                                            "list_tarefas": "b"}).json()["id"]
    http.post(f"/api/areas/{area_id}/vinculos", json={"identificador": "EXPANSAO OSASCO"})

    status = http.get("/api/status").json()

    assert status["ready"] is True
    assert status["area_padrao"] == area_id
    assert status["areas"][0]["vinculos"][0]["identificador"] == "EXPANSAO OSASCO"
    assert status["chaves"]["gemini"] is True


# --------------------------------------------------------------------- chaves
def test_salvar_chaves_grava_no_env(ambiente, tmp_path, monkeypatch):
    env = tmp_path / ".env"
    env.write_text("GEMINI_API_KEY=antiga\nTRELLO_API_KEY=x\nTRELLO_TOKEN=y\n", encoding="utf-8")
    monkeypatch.setattr("main.ENV_PATH", env)
    monkeypatch.setattr("cerebro.config.ENV_PATH", env)
    gravados: dict = {}
    monkeypatch.setattr("main.write_env_values", lambda valores: gravados.update(valores))
    monkeypatch.setattr("main.reload_settings", lambda: ambiente_settings)

    http, criados = ambiente()
    ambiente_settings = criados["settings"]

    resposta = http.post(
        "/api/config/chaves",
        json={"gemini_api_key": "nova-chave", "trello_api_key": "k2",
              "trello_token": "t2", "trello_secret": "s2"},
    )

    assert resposta.status_code == 200
    assert gravados == {
        "GEMINI_API_KEY": "nova-chave", "TRELLO_API_KEY": "k2",
        "TRELLO_TOKEN": "t2", "TRELLO_SECRET": "s2",
    }


def test_salvar_chaves_ignora_campos_em_branco(ambiente, monkeypatch):
    gravados: dict = {}
    monkeypatch.setattr("main.write_env_values", lambda valores: gravados.update(valores))
    http, criados = ambiente()
    monkeypatch.setattr("main.reload_settings", lambda: criados["settings"])

    http.post("/api/config/chaves", json={"gemini_api_key": "só-esta", "trello_token": "  "})

    assert gravados == {"GEMINI_API_KEY": "só-esta"}


def test_salvar_chaves_sem_nada_responde_400(ambiente):
    http, _ = ambiente()
    assert http.post("/api/config/chaves", json={}).status_code == 400


# ------------------------------------------------------------------- whatsapp
def test_whatsapp_roteia_para_a_area_do_grupo(ambiente):
    http, criados = ambiente(whatsapp_provider="evolution")
    midia = _area_pronta(criados, "Mídia", ideias="ideias_midia", tarefas="tarefas_midia")
    _area_pronta(criados, "Louvor", ideias="ideias_louvor", tarefas="tarefas_louvor")
    criados["areas"].vincular(midia.id, "EXPANSAO OSASCO")

    resposta = http.post("/webhook/whatsapp", json=evolution_payload())

    assert resposta.json()["status"] == "created"
    assert criados["trello"].cards[0]["idList"] == "tarefas_midia"
    assert criados["store"].historico()[0]["area_nome"] == "Mídia"


def test_grupo_sem_vinculo_cai_na_area_padrao(ambiente):
    http, criados = ambiente(whatsapp_provider="evolution")
    padrao = _area_pronta(criados, "Padrão", ideias="i_padrao", tarefas="t_padrao")

    resposta = http.post("/webhook/whatsapp", json=evolution_payload(grupo="Grupo Novo"))

    assert resposta.json()["status"] == "created"
    assert criados["trello"].cards[0]["idList"] == "t_padrao"
    assert padrao.padrao is True


def test_sem_nenhuma_area_a_mensagem_e_enfileirada(ambiente):
    http, criados = ambiente(whatsapp_provider="evolution")

    resposta = http.post("/webhook/whatsapp", json=evolution_payload())

    assert resposta.json()["status"] == "queued"
    assert criados["store"].estatisticas()["pendentes"] == 1


def test_area_sem_colunas_enfileira_em_vez_de_perder(ambiente):
    http, criados = ambiente(whatsapp_provider="evolution")
    area = criados["areas"].criar("Sem colunas")
    criados["areas"].vincular(area.id, "EXPANSAO OSASCO")

    resposta = http.post("/webhook/whatsapp", json=evolution_payload())

    assert resposta.json()["status"] == "queued"
    assert "colunas" in resposta.json()["detail"]
    assert criados["store"].estatisticas()["pendentes"] == 1


def test_duplicata_nao_cria_dois_cartoes(ambiente):
    http, criados = ambiente(whatsapp_provider="evolution")
    _area_pronta(criados)

    http.post("/webhook/whatsapp", json=evolution_payload(id_="WA-9"))
    segunda = http.post("/webhook/whatsapp", json=evolution_payload(id_="WA-9"))

    assert segunda.json()["status"] == "duplicate"
    assert len(criados["trello"].cards) == 1


# ---------------------------------------------------- comandos vindos do grupo
def test_comando_start_liga_o_grupo_a_area(ambiente):
    http, criados = ambiente(whatsapp_provider="evolution")
    midia = _area_pronta(criados, "Mídia")

    resposta = http.post(
        "/webhook/whatsapp",
        json=evolution_payload(texto="START TRELLO Mídia", id_="CMD-1"),
    )

    assert resposta.json()["status"] == "command"
    assert criados["areas"].area_de("EXPANSAO OSASCO").id == midia.id
    assert criados["trello"].cards == []          # comando não vira cartão
    assert criados["store"].historico()[0]["status"] == "comando"


def test_depois_do_start_as_mensagens_vao_para_a_area_escolhida(ambiente):
    http, criados = ambiente(whatsapp_provider="evolution")
    _area_pronta(criados, "Padrão", ideias="i_padrao", tarefas="t_padrao")
    _area_pronta(criados, "Mídia", ideias="i_midia", tarefas="t_midia")

    http.post("/webhook/whatsapp", json=evolution_payload(texto="START TRELLO Mídia", id_="c1"))
    http.post("/webhook/whatsapp", json=evolution_payload(id_="m1"))

    assert criados["trello"].cards[0]["idList"] == "t_midia"


def test_comando_com_area_inexistente_explica(ambiente):
    http, criados = ambiente(whatsapp_provider="evolution")
    _area_pronta(criados, "Mídia")

    resposta = http.post(
        "/webhook/whatsapp",
        json=evolution_payload(texto="START TRELLO Marketing", id_="CMD-2"),
    )

    corpo = resposta.json()
    assert corpo["status"] == "command_failed"
    assert "Mídia" in corpo["detail"]   # lista as áreas existentes


def test_comando_parar_desliga_o_grupo(ambiente):
    http, criados = ambiente(whatsapp_provider="evolution")
    midia = _area_pronta(criados, "Mídia")
    criados["areas"].vincular(midia.id, "EXPANSAO OSASCO")

    resposta = http.post(
        "/webhook/whatsapp", json=evolution_payload(texto="PARAR TRELLO", id_="CMD-3")
    )

    assert resposta.json()["status"] == "command"
    assert criados["areas"].area_de("EXPANSAO OSASCO") is None


def test_comando_status_informa_a_area(ambiente):
    http, criados = ambiente(whatsapp_provider="evolution")
    midia = _area_pronta(criados, "Mídia")
    criados["areas"].vincular(midia.id, "EXPANSAO OSASCO")

    resposta = http.post(
        "/webhook/whatsapp", json=evolution_payload(texto="STATUS TRELLO", id_="CMD-4")
    )

    assert "Mídia" in resposta.json()["detail"]


def test_comando_areas_lista_as_cadastradas(ambiente):
    http, criados = ambiente(whatsapp_provider="evolution")
    _area_pronta(criados, "Mídia")
    _area_pronta(criados, "Louvor", ideias="c", tarefas="d")

    resposta = http.post(
        "/webhook/whatsapp", json=evolution_payload(texto="AREAS TRELLO", id_="CMD-5")
    )

    detalhe = resposta.json()["detail"]
    assert "Mídia" in detalhe and "Louvor" in detalhe


def test_mensagem_normal_nao_e_confundida_com_comando(ambiente):
    http, criados = ambiente(whatsapp_provider="evolution")
    _area_pronta(criados)

    resposta = http.post(
        "/webhook/whatsapp",
        json=evolution_payload(texto="vamos dar o start na gravação domingo", id_="m2"),
    )

    assert resposta.json()["status"] == "created"


# -------------------------------------------------------------------- estúdio
class FakeEstudio:
    def __init__(self) -> None:
        self.pedidos: list[tuple] = []

    def gerar_ideias(self, tema, *, quantidade=5, contexto=None):
        self.pedidos.append((tema, quantidade, tuple(contexto or ())))
        return [Ideia(title="Série de reels", description="Três cortes.", formato="Reels",
                      esforco="baixo", due_date=None)]

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


def test_estudio_usa_a_area_escolhida(com_estudio):
    http, criados = com_estudio()
    _area_pronta(criados, "Padrão")
    midia = _area_pronta(criados, "Mídia", ideias="i_midia", tarefas="t_midia")

    resposta = http.post("/api/estudio/ideias",
                         json={"tema": "Vigília", "quantidade": 3, "area_id": midia.id})

    assert resposta.status_code == 200
    assert resposta.json()["area"] == "Mídia"


def test_estudio_cai_na_area_padrao_sem_area_id(com_estudio):
    http, criados = com_estudio()
    _area_pronta(criados, "Padrão")
    resposta = http.post("/api/estudio/ideias", json={"tema": "Vigília"})
    assert resposta.json()["area"] == "Padrão"


def test_criar_cartoes_na_area_escolhida(com_estudio):
    http, criados = com_estudio()
    _area_pronta(criados, "Padrão")
    midia = _area_pronta(criados, "Mídia", ideias="i_midia", tarefas="t_midia")

    resposta = http.post(
        "/api/estudio/criar-cartoes",
        json={"destino": "ideias", "area_id": midia.id,
              "ideias": [{"title": "Série de reels", "description": "Três cortes.",
                          "formato": "Reels"}]},
    )

    assert resposta.status_code == 200
    assert criados["trello"].cards[0]["idList"] == "i_midia"
    assert "(Mídia)" in criados["trello"].cards[0]["desc"]


def test_organizar_usa_a_area(com_estudio):
    http, criados = com_estudio()
    _area_pronta(criados, "Mídia")
    resposta = http.post("/api/estudio/organizar", json={})
    assert resposta.json()["area"] == "Mídia"


def test_estudio_sem_area_cadastrada_responde_409(com_estudio):
    http, _ = com_estudio()
    resposta = http.post("/api/estudio/ideias", json={"tema": "Vigília"})
    assert resposta.status_code == 409


# ------------------------------------------------------------- webhook manual
def test_webhook_manual_aceita_area_id(ambiente):
    http, criados = ambiente()
    _area_pronta(criados, "Padrão")
    midia = _area_pronta(criados, "Mídia", ideias="i_midia", tarefas="t_midia")

    resposta = http.post("/webhook", json={"text": "Gravar no domingo", "area_id": midia.id})

    assert resposta.json()["area"] == "Mídia"
    assert criados["trello"].cards[0]["idList"] == "t_midia"


def test_webhook_manual_sem_area_cadastrada_responde_409(ambiente):
    http, _ = ambiente()
    resposta = http.post("/webhook", json={"text": "Gravar no domingo"})
    assert resposta.status_code == 409


# ---------------------------------------------------------------------- token
def test_sem_token_configurado_o_acesso_e_livre(ambiente):
    http, _ = ambiente(server_token="")
    assert http.get("/api/status").status_code == 200


def test_com_token_o_acesso_remoto_e_barrado(ambiente):
    http, _ = ambiente(server_token="senha-da-equipe")
    resposta = http.get("/api/status")
    assert resposta.status_code == 401
    assert resposta.json()["stage"] == "auth"


def test_token_correto_libera(ambiente):
    http, _ = ambiente(server_token="senha-da-equipe")
    assert http.get("/api/status", headers={"X-Cerebro-Token": "senha-da-equipe"}).status_code == 200
    assert http.get("/api/status?token=senha-da-equipe").status_code == 200


def test_rotas_livres_continuam_abertas_com_token(ambiente):
    http, _ = ambiente(server_token="senha-da-equipe")
    assert http.get("/health").status_code == 200
    assert http.get("/").status_code == 200


def test_webhook_do_whatsapp_nao_usa_o_token_do_painel(ambiente):
    http, criados = ambiente(server_token="senha", whatsapp_provider="evolution")
    _area_pronta(criados)
    resposta = http.post("/webhook/whatsapp", json=evolution_payload(id_="WA-TOKEN"))
    assert resposta.status_code == 200
