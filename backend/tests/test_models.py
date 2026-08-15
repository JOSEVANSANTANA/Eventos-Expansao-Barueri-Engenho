from __future__ import annotations

import pytest
from pydantic import ValidationError

from cerebro.models import (
    ActionType,
    Classification,
    WebhookMessage,
    normalize_action,
    normalize_due_date,
)


@pytest.mark.parametrize(
    ("raw", "esperado"),
    [
        ("ideia", ActionType.IDEIA),
        ("Ideia", ActionType.IDEIA),
        ("IDÉIA", ActionType.IDEIA),
        ("referências", ActionType.IDEIA),
        ("tarefa", ActionType.TAREFA),
        (" TAREFA ", ActionType.TAREFA),
        ("decisão", ActionType.TAREFA),
        ("ignorar", ActionType.IGNORAR),
        ("bate papo", ActionType.IGNORAR),
        ("qualquer_coisa", ActionType.IGNORAR),
        (None, ActionType.IGNORAR),
        ("", ActionType.IGNORAR),
    ],
)
def test_normalize_action(raw, esperado):
    assert normalize_action(raw) is esperado


def test_due_date_apenas_data_vira_meio_dia_local_em_utc():
    # 12:00 em São Paulo (UTC-3) = 15:00 UTC, ainda no mesmo dia.
    assert normalize_due_date("2026-08-16") == "2026-08-16T15:00:00.000Z"


def test_due_date_com_hora_sem_fuso_assume_fuso_da_equipe():
    assert normalize_due_date("2026-08-16T19:30:00") == "2026-08-16T22:30:00.000Z"


def test_due_date_com_offset_explicito_e_respeitado():
    assert normalize_due_date("2026-08-16T19:30:00-03:00") == "2026-08-16T22:30:00.000Z"


def test_due_date_com_sufixo_z():
    assert normalize_due_date("2026-08-16T22:30:00Z") == "2026-08-16T22:30:00.000Z"


@pytest.mark.parametrize("raw", [None, "", "null", "domingo que vem", "32/13/2026", "em breve"])
def test_due_date_invalida_vira_none(raw):
    assert normalize_due_date(raw) is None


def test_classification_from_payload_completo():
    resultado = Classification.from_payload(
        {
            "action_type": "tarefa",
            "title": "  Gravar   vídeos da Vigília ",
            "description": "Gravação ao final do culto.",
            "due_date": "2026-08-16",
        },
        fallback_text="mensagem original",
    )
    assert resultado.action_type is ActionType.TAREFA
    assert resultado.title == "Gravar vídeos da Vigília"
    assert resultado.due_date == "2026-08-16T15:00:00.000Z"
    assert resultado.actionable is True


def test_classification_preenche_lacunas_com_a_mensagem():
    resultado = Classification.from_payload(
        {"action_type": "ideia"}, fallback_text="Referência de transição de vídeo"
    )
    assert resultado.title == "Referência de transição de vídeo"
    assert resultado.description == "Referência de transição de vídeo"
    assert resultado.due_date is None


def test_classification_ignorar_nao_e_acionavel():
    resultado = Classification.from_payload(
        {"action_type": "ignorar", "title": "", "description": ""}, fallback_text="kkkk"
    )
    assert resultado.actionable is False
    assert resultado.title == ""


def test_classification_titulo_muito_longo_e_truncado():
    resultado = Classification.from_payload(
        {"action_type": "tarefa"}, fallback_text="palavra " * 200
    )
    assert len(resultado.title) <= 200


def test_webhook_message_rejeita_texto_em_branco():
    with pytest.raises(ValidationError):
        WebhookMessage(text="   ")


def test_webhook_message_preview_limita_tamanho():
    message = WebhookMessage(text="a" * 300)
    assert len(message.preview(50)) == 50
    assert message.preview(50).endswith("…")
