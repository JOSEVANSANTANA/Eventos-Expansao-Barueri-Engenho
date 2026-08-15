from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from cerebro.db import MAX_TENTATIVAS, Store
from cerebro.models import ActionType, WebhookResponse


@pytest.fixture
def store(tmp_path):
    banco = Store(tmp_path / "fila.db")
    yield banco
    banco.close()


def _resposta(status="created", **extra):
    base = {
        "status": status,
        "action_type": ActionType.TAREFA,
        "title": "Gravar vídeos",
        "card_id": "card_1",
        "card_url": "https://trello.com/c/abc",
        "due_date": None,
    }
    base.update(extra)
    return WebhookResponse(**base)


def test_mensagem_nasce_pendente(store):
    mensagem_id = store.registrar("gravar vídeos no domingo", autor="Vando")
    assert mensagem_id == 1
    assert store.estatisticas()["pendentes"] == 1
    assert len(store.pendentes_vencidas()) == 1


def test_sucesso_guarda_o_cartao(store):
    mensagem_id = store.registrar("gravar vídeos")
    store.marcar_sucesso(mensagem_id, _resposta())

    item = store.historico()[0]
    assert item["status"] == "criado"
    assert item["card_url"] == "https://trello.com/c/abc"
    assert item["processada_em"]
    assert store.estatisticas() == {
        "pendentes": 0, "criados": 1, "ignorados": 0, "erros": 0, "total": 1
    }


def test_ignorada_conta_separado(store):
    mensagem_id = store.registrar("kkkk")
    store.marcar_sucesso(mensagem_id, _resposta(status="ignored", action_type=ActionType.IGNORAR))
    assert store.estatisticas()["ignorados"] == 1


def test_falha_reagenda_com_backoff(store):
    mensagem_id = store.registrar("mensagem")
    store.marcar_falha(mensagem_id, "trello", "timeout")

    item = store.historico()[0]
    assert item["status"] == "pendente"
    assert item["tentativas"] == 1
    assert item["stage"] == "trello"
    # Ainda não venceu: o worker não deve pegá-la agora.
    assert store.pendentes_vencidas() == []

    proxima = datetime.fromisoformat(item["proxima_tentativa"])
    assert proxima > datetime.now(ZoneInfo("America/Sao_Paulo"))


def test_falha_permanente_nao_reagenda(store):
    mensagem_id = store.registrar("mensagem")
    store.marcar_falha(mensagem_id, "gemini", "API key not valid", reagendar=False)

    item = store.historico()[0]
    assert item["status"] == "erro"
    assert store.pendentes_vencidas() == []


def test_desiste_depois_do_limite_de_tentativas(store):
    mensagem_id = store.registrar("mensagem")
    for _ in range(MAX_TENTATIVAS):
        store.marcar_falha(mensagem_id, "trello", "timeout")

    assert store.historico()[0]["status"] == "erro"


def test_reenfileirar_erros_devolve_para_a_fila(store):
    mensagem_id = store.registrar("mensagem")
    store.marcar_falha(mensagem_id, "trello", "erro", reagendar=False)

    assert store.reenfileirar_erros() == 1
    assert len(store.pendentes_vencidas()) == 1
    assert store.historico()[0]["tentativas"] == 0


def test_external_id_evita_duplicata_do_whatsapp(store):
    assert store.registrar("mesma mensagem", external_id="WA-1") is not None
    assert store.registrar("mesma mensagem", external_id="WA-1") is None
    assert store.estatisticas()["total"] == 1


def test_mensagens_sem_external_id_nao_colidem(store):
    store.registrar("uma")
    store.registrar("outra")
    assert store.estatisticas()["total"] == 2


def test_limpar_preserva_a_fila(store):
    concluida = store.registrar("concluída")
    store.marcar_sucesso(concluida, _resposta())
    store.registrar("ainda pendente")

    assert store.limpar(apenas_concluidas=True) == 1
    assert store.estatisticas() == {
        "pendentes": 1, "criados": 0, "ignorados": 0, "erros": 0, "total": 1
    }


def test_limpar_tudo(store):
    store.registrar("uma")
    store.registrar("outra")
    assert store.limpar(apenas_concluidas=False) == 2
    assert store.estatisticas()["total"] == 0


def test_dados_sobrevivem_a_reabertura(tmp_path):
    caminho = tmp_path / "persistente.db"
    primeiro = Store(caminho)
    primeiro.registrar("mensagem que precisa sobreviver", origem="whatsapp")
    primeiro.close()

    segundo = Store(caminho)
    try:
        itens = segundo.historico()
        assert len(itens) == 1
        assert itens[0]["texto"] == "mensagem que precisa sobreviver"
        assert itens[0]["origem"] == "whatsapp"
    finally:
        segundo.close()


def test_historico_mais_recente_primeiro(store):
    store.registrar("antiga")
    store.registrar("nova")
    assert store.historico()[0]["texto"] == "nova"
