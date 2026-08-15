from __future__ import annotations

import hashlib
import hmac
import json

import pytest

from cerebro.whatsapp import (
    WhatsAppError,
    traduzir,
    verificar_apikey_evolution,
    verificar_assinatura_meta,
)


def evolution(texto="Vamos gravar no domingo", *, from_me=False, jid="1203@g.us",
              grupo="EXPANSAO OSASCO", id_="WA-1", message=None):
    return {
        "event": "messages.upsert",
        "instance": "cerebro",
        "data": {
            "key": {"remoteJid": jid, "fromMe": from_me, "id": id_},
            "pushName": "Lívia",
            "groupName": grupo,
            "message": message if message is not None else {"conversation": texto},
        },
    }


# ------------------------------------------------------------------- evolution
def test_evolution_extrai_mensagem_de_grupo():
    evento = traduzir(evolution(), provedor="evolution")

    assert evento.processar
    assert evento.mensagem.text == "Vamos gravar no domingo"
    assert evento.mensagem.sender == "Lívia"
    assert evento.mensagem.group == "EXPANSAO OSASCO"
    assert evento.external_id == "WA-1"


def test_evolution_le_texto_estendido():
    payload = evolution(message={"extendedTextMessage": {"text": "resposta citando alguém"}})
    assert traduzir(payload, provedor="evolution").mensagem.text == "resposta citando alguém"


def test_evolution_le_legenda_de_imagem():
    payload = evolution(message={"imageMessage": {"caption": "referência de arte"}})
    assert traduzir(payload, provedor="evolution").mensagem.text == "referência de arte"


def test_evolution_ignora_mensagem_propria():
    evento = traduzir(evolution(from_me=True), provedor="evolution")
    assert not evento.processar
    assert "enviada por mim" in evento.motivo_ignorado


def test_evolution_aceita_propria_quando_configurado():
    evento = traduzir(evolution(from_me=True), provedor="evolution", ignorar_proprias=False)
    assert evento.processar


def test_evolution_ignora_audio_e_figurinha():
    evento = traduzir(evolution(message={"audioMessage": {"seconds": 3}}), provedor="evolution")
    assert not evento.processar
    assert "sem texto" in evento.motivo_ignorado


def test_evolution_filtra_grupo_nao_autorizado():
    evento = traduzir(evolution(grupo="Família"), provedor="evolution", grupos=("EXPANSAO",))
    assert not evento.processar
    assert "não autorizado" in evento.motivo_ignorado


def test_evolution_aceita_grupo_da_lista_sem_diferenciar_caixa():
    evento = traduzir(evolution(grupo="Expansao Osasco"), provedor="evolution",
                      grupos=("EXPANSAO OSASCO",))
    assert evento.processar


def test_evolution_ignora_conversa_direta_quando_ha_lista_de_grupos():
    evento = traduzir(evolution(jid="5511999@s.whatsapp.net", grupo=None),
                      provedor="evolution", grupos=("EXPANSAO",))
    assert not evento.processar


def test_evolution_ignora_outros_eventos():
    evento = traduzir({"event": "connection.update", "data": {}}, provedor="evolution")
    assert not evento.processar
    assert "evento ignorado" in evento.motivo_ignorado


def test_evolution_payload_quebrado_levanta_erro():
    with pytest.raises(WhatsAppError):
        traduzir({"event": "messages.upsert", "data": "texto solto"}, provedor="evolution")


# ------------------------------------------------------------------------ meta
def meta_payload(texto="Confirmado o ensaio de sábado", id_="wamid.1"):
    return {
        "entry": [
            {
                "changes": [
                    {
                        "value": {
                            "metadata": {"display_phone_number": "5511999999999"},
                            "contacts": [{"profile": {"name": "Letícia"}}],
                            "messages": [
                                {"from": "5511888", "id": id_, "type": "text",
                                 "text": {"body": texto}}
                            ],
                        }
                    }
                ]
            }
        ]
    }


def test_meta_extrai_mensagem():
    evento = traduzir(meta_payload(), provedor="meta")
    assert evento.mensagem.text == "Confirmado o ensaio de sábado"
    assert evento.mensagem.sender == "Letícia"
    assert evento.external_id == "wamid.1"


def test_meta_ignora_notificacao_de_status():
    payload = {"entry": [{"changes": [{"value": {"statuses": [{"status": "delivered"}]}}]}]}
    evento = traduzir(payload, provedor="meta")
    assert not evento.processar
    assert "sem mensagem" in evento.motivo_ignorado


def test_meta_payload_invalido_levanta_erro():
    with pytest.raises(WhatsAppError, match="Cloud API"):
        traduzir({"foo": "bar"}, provedor="meta")


def test_assinatura_meta_valida():
    corpo = json.dumps(meta_payload()).encode()
    segredo = "segredo-do-app"
    assinatura = "sha256=" + hmac.new(segredo.encode(), corpo, hashlib.sha256).hexdigest()
    assert verificar_assinatura_meta(corpo, assinatura, segredo) is True


def test_assinatura_meta_invalida_e_recusada():
    corpo = b'{"entry": []}'
    assert verificar_assinatura_meta(corpo, "sha256=abc", "segredo") is False
    assert verificar_assinatura_meta(corpo, None, "segredo") is False


def test_sem_segredo_configurado_a_assinatura_nao_bloqueia():
    assert verificar_assinatura_meta(b"{}", None, "") is True


# -------------------------------------------------------------------- genérico
def test_generico_aceita_payload_simples():
    evento = traduzir(
        {"text": "Ideia de reels", "sender": "Vando", "group": "EXPANSAO OSASCO", "id": "X1"},
        provedor="generico",
    )
    assert evento.mensagem.text == "Ideia de reels"
    assert evento.external_id == "X1"


def test_generico_aceita_nomes_em_portugues():
    evento = traduzir({"mensagem": "Ideia nova", "autor": "Lívia"}, provedor="generico")
    assert evento.mensagem.text == "Ideia nova"
    assert evento.mensagem.sender == "Lívia"


def test_generico_rejeita_texto_vazio():
    evento = traduzir({"text": "   "}, provedor="generico")
    assert not evento.processar


# ------------------------------------------------------------------- provedores
def test_provedor_desligado_levanta_erro_orientando():
    with pytest.raises(WhatsAppError, match="WHATSAPP_PROVIDER"):
        traduzir({"text": "oi"}, provedor="nenhum")


def test_apikey_evolution():
    assert verificar_apikey_evolution("abc", "abc") is True
    assert verificar_apikey_evolution("errada", "abc") is False
    assert verificar_apikey_evolution(None, "abc") is False
    assert verificar_apikey_evolution(None, "") is True  # sem chave configurada
