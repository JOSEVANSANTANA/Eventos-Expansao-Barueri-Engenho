"""Entrada de mensagens do WhatsApp.

Traduz o payload de cada provedor para o formato interno e decide o que é para
processar e o que é para descartar (mensagem própria, grupo não autorizado,
mensagem sem texto). Nenhum provedor é obrigatório: sem configuração, a rota
simplesmente responde que o WhatsApp está desligado.

Provedores suportados (`WHATSAPP_PROVIDER` no .env):

  evolution  Evolution API — self-hosted, lê grupos, roda em Docker no próprio Mac.
  meta       WhatsApp Cloud API oficial da Meta (só conversas diretas: a API
             oficial não entrega mensagens de grupo).
  generico   Qualquer automação (Atalhos do iOS, n8n, Make, Zapier) que poste
             {"text": "...", "sender": "...", "group": "...", "id": "..."}.
"""

from __future__ import annotations

import hashlib
import hmac
from dataclasses import dataclass
from typing import Any

from .models import WebhookMessage

PROVEDORES = {"nenhum", "evolution", "meta", "generico"}


class WhatsAppError(RuntimeError):
    """Payload inválido ou autenticação recusada."""


@dataclass(frozen=True)
class EventoWhatsApp:
    """Resultado da tradução: ou tem mensagem, ou tem motivo para ignorar."""

    mensagem: WebhookMessage | None = None
    external_id: str | None = None
    motivo_ignorado: str | None = None

    @property
    def processar(self) -> bool:
        return self.mensagem is not None


# ------------------------------------------------------------------ utilitários
def _texto_de_message(message: dict[str, Any]) -> str:
    """Extrai texto dos formatos que o WhatsApp usa (Baileys/Evolution)."""
    if not isinstance(message, dict):
        return ""
    direto = message.get("conversation")
    if isinstance(direto, str) and direto.strip():
        return direto
    for chave in ("extendedTextMessage", "imageMessage", "videoMessage", "documentMessage"):
        bloco = message.get(chave)
        if isinstance(bloco, dict):
            for campo in ("text", "caption"):
                valor = bloco.get(campo)
                if isinstance(valor, str) and valor.strip():
                    return valor
    return ""


def _grupo_autorizado(grupo: str | None, permitidos: tuple[str, ...]) -> bool:
    """Sem lista configurada, tudo passa. Com lista, casa por trecho (sem acento/caixa)."""
    if not permitidos:
        return True
    alvo = (grupo or "").lower()
    return any(p.lower() in alvo for p in permitidos if p)


def verificar_assinatura_meta(corpo: bytes, cabecalho: str | None, app_secret: str) -> bool:
    """Confere o X-Hub-Signature-256 da Meta. Sem segredo configurado, não bloqueia."""
    if not app_secret:
        return True
    if not cabecalho or not cabecalho.startswith("sha256="):
        return False
    esperado = hmac.new(app_secret.encode(), corpo, hashlib.sha256).hexdigest()
    return hmac.compare_digest(esperado, cabecalho.split("=", 1)[1].strip())


def verificar_apikey_evolution(recebida: str | None, esperada: str) -> bool:
    """Evolution manda a apikey da instância no cabeçalho. Sem valor configurado,
    não bloqueia (útil quando o Evolution roda no mesmo Mac, sem exposição)."""
    if not esperada:
        return True
    return bool(recebida) and hmac.compare_digest(recebida.strip(), esperada.strip())


# -------------------------------------------------------------------- tradutores
def _de_evolution(
    payload: dict[str, Any], *, grupos: tuple[str, ...], ignorar_proprias: bool
) -> EventoWhatsApp:
    evento = payload.get("event") or payload.get("Event") or ""
    if evento and "messages.upsert" not in str(evento).lower():
        return EventoWhatsApp(motivo_ignorado=f"evento ignorado: {evento}")

    dados = payload.get("data") or payload
    if isinstance(dados, list):  # algumas versões mandam lote
        dados = dados[0] if dados else {}
    if not isinstance(dados, dict):
        raise WhatsAppError("campo 'data' ausente ou inválido")

    chave = dados.get("key") or {}
    remote_jid = chave.get("remoteJid") or ""
    de_grupo = remote_jid.endswith("@g.us")

    if ignorar_proprias and chave.get("fromMe"):
        return EventoWhatsApp(motivo_ignorado="mensagem enviada por mim")

    texto = _texto_de_message(dados.get("message") or {})
    if not texto.strip():
        return EventoWhatsApp(motivo_ignorado="mensagem sem texto (áudio, figurinha, etc.)")

    grupo = dados.get("groupName") or dados.get("groupSubject") or (remote_jid if de_grupo else None)
    if de_grupo and not _grupo_autorizado(grupo, grupos):
        return EventoWhatsApp(motivo_ignorado=f"grupo não autorizado: {grupo}")
    if not de_grupo and grupos:
        return EventoWhatsApp(motivo_ignorado="conversa direta (só grupos autorizados)")

    return EventoWhatsApp(
        mensagem=WebhookMessage(
            text=texto[:8000],
            sender=(dados.get("pushName") or chave.get("participant") or "")[:120] or None,
            group=(grupo or "")[:120] or None,
        ),
        external_id=chave.get("id"),
    )


def _de_meta(payload: dict[str, Any], *, grupos: tuple[str, ...]) -> EventoWhatsApp:
    try:
        valor = payload["entry"][0]["changes"][0]["value"]
    except (KeyError, IndexError, TypeError) as exc:
        raise WhatsAppError("payload fora do formato da Cloud API") from exc

    mensagens = valor.get("messages") or []
    if not mensagens:
        return EventoWhatsApp(motivo_ignorado="notificação sem mensagem (status/entrega)")

    mensagem = mensagens[0]
    texto = (mensagem.get("text") or {}).get("body") or ""
    if not texto.strip():
        return EventoWhatsApp(
            motivo_ignorado=f"mensagem do tipo '{mensagem.get('type')}' sem texto"
        )

    contatos = valor.get("contacts") or []
    autor = (contatos[0].get("profile", {}).get("name") if contatos else None) or mensagem.get("from")
    # A Cloud API não entrega grupos; o "grupo" aqui é o número de negócio.
    grupo = (valor.get("metadata") or {}).get("display_phone_number")
    if not _grupo_autorizado(grupo, grupos):
        return EventoWhatsApp(motivo_ignorado=f"origem não autorizada: {grupo}")

    return EventoWhatsApp(
        mensagem=WebhookMessage(
            text=texto[:8000],
            sender=(autor or "")[:120] or None,
            group=(grupo or "WhatsApp")[:120],
        ),
        external_id=mensagem.get("id"),
    )


def _de_generico(payload: dict[str, Any], *, grupos: tuple[str, ...]) -> EventoWhatsApp:
    texto = payload.get("text") or payload.get("mensagem") or payload.get("body") or ""
    if not str(texto).strip():
        return EventoWhatsApp(motivo_ignorado="campo 'text' vazio")

    grupo = payload.get("group") or payload.get("grupo")
    if not _grupo_autorizado(grupo, grupos):
        return EventoWhatsApp(motivo_ignorado=f"grupo não autorizado: {grupo}")

    return EventoWhatsApp(
        mensagem=WebhookMessage(
            text=str(texto)[:8000],
            sender=(str(payload.get("sender") or payload.get("autor") or "") or None),
            group=(str(grupo) if grupo else None),
        ),
        external_id=payload.get("id") or payload.get("message_id"),
    )


def traduzir(
    payload: dict[str, Any],
    *,
    provedor: str,
    grupos: tuple[str, ...] = (),
    ignorar_proprias: bool = True,
) -> EventoWhatsApp:
    """Ponto único de entrada: escolhe o tradutor conforme o provedor configurado."""
    provedor = (provedor or "nenhum").strip().lower()
    if provedor == "evolution":
        return _de_evolution(payload, grupos=grupos, ignorar_proprias=ignorar_proprias)
    if provedor == "meta":
        return _de_meta(payload, grupos=grupos)
    if provedor == "generico":
        return _de_generico(payload, grupos=grupos)
    raise WhatsAppError(
        f"provedor '{provedor}' não configurado. "
        f"Defina WHATSAPP_PROVIDER como evolution, meta ou generico."
    )
