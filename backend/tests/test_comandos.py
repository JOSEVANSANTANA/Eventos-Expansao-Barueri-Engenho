"""Comandos digitados no grupo do WhatsApp."""

from __future__ import annotations

import pytest

from cerebro.comandos import AJUDA, DESVINCULAR, LISTAR, STATUS, VINCULAR, interpretar


@pytest.mark.parametrize(
    "texto",
    [
        "START TRELLO EXPANSAO OSASCO",
        "start trello EXPANSAO OSASCO",
        "Start Trello Expansão Osasco",
        "/start trello EXPANSAO OSASCO",
        "  START   TRELLO   EXPANSAO OSASCO  ",
        "iniciar trello EXPANSAO OSASCO",
        "conectar trello EXPANSAO OSASCO",
        "ligar trello EXPANSAO OSASCO",
        "vincular area EXPANSAO OSASCO",
    ],
)
def test_variacoes_de_vincular(texto):
    comando = interpretar(texto)
    assert comando is not None
    assert comando.acao == VINCULAR


def test_alvo_preserva_acento_e_caixa_originais():
    comando = interpretar("start trello Expansão Osasco")
    assert comando.alvo == "Expansão Osasco"


def test_atalho_sem_a_palavra_trello():
    comando = interpretar("START Mídia")
    assert comando.acao == VINCULAR
    assert comando.alvo == "Mídia"


@pytest.mark.parametrize(
    "texto",
    ["PARAR TRELLO", "stop trello", "desligar trello", "/desconectar trello", "desvincular area"],
)
def test_variacoes_de_desvincular(texto):
    assert interpretar(texto).acao == DESVINCULAR


def test_status_e_listar():
    assert interpretar("STATUS TRELLO").acao == STATUS
    assert interpretar("status area").acao == STATUS
    assert interpretar("AREAS TRELLO").acao == LISTAR
    assert interpretar("areas").acao == LISTAR


def test_ajuda():
    assert interpretar("ajuda trello").acao == AJUDA
    assert interpretar("comandos trello").acao == AJUDA


# ----------------------------------------------------------- o que NÃO é comando
@pytest.mark.parametrize(
    "texto",
    [
        "Vamos começar a gravar no domingo",
        "o start do culto é às 19h",
        "precisamos parar de atrasar as artes",
        "status da arte: quase pronta",
        "",
        "   ",
        "Alguém viu o trello hoje?",
    ],
)
def test_conversa_normal_nao_e_comando(texto):
    assert interpretar(texto) is None


def test_mensagem_longa_que_comeca_com_start_nao_e_comando():
    """Evita sequestrar uma mensagem de verdade que por acaso começa com a palavra."""
    texto = (
        "start do projeto foi confirmado para domingo e precisamos gravar os vídeos "
        "logo depois do culto, com a Lívia cuidando das referências e a Letícia do roteiro"
    )
    assert interpretar(texto) is None


def test_so_a_primeira_linha_conta():
    comando = interpretar("START TRELLO Mídia\nresto da mensagem que não importa")
    assert comando.acao == VINCULAR
    assert comando.alvo == "Mídia"


def test_pontuacao_no_fim_e_tolerada():
    assert interpretar("status trello.").acao == STATUS
    assert interpretar("PARAR TRELLO!").acao == DESVINCULAR
