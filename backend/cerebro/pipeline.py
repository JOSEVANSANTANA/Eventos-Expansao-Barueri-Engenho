"""Orquestração: mensagem → classificação (Gemini) → cartão (Trello)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from .config import Settings
from .console import bold, dim, green, log, yellow
from .models import ActionType, Classification, WebhookMessage, WebhookResponse
from .trello import TrelloClient


class Analyzer(Protocol):
    """Contrato mínimo da camada de IA — permite injetar um dublê nos testes."""

    def analyze(self, message: WebhookMessage) -> Classification: ...


@dataclass(frozen=True)
class Pipeline:
    settings: Settings
    analyzer: Analyzer
    trello: TrelloClient

    def list_id_for(self, action: ActionType) -> str | None:
        return {
            ActionType.IDEIA: self.settings.trello_list_id_ideias,
            ActionType.TAREFA: self.settings.trello_list_id_tarefas,
        }.get(action)

    def process(self, message: WebhookMessage) -> WebhookResponse:
        origem = f" [{message.group}]" if message.group else ""
        autor = f"{message.sender}: " if message.sender else ""
        log.info("Mensagem recebida%s — %s%s", dim(origem), autor, message.preview())

        classification = self.analyzer.analyze(message)
        log.info(
            "Gemini classificou como %s", bold(classification.action_type.value.upper())
        )

        if not classification.actionable:
            log.info("%s", yellow("Bate-papo — nada a criar no Trello."))
            return WebhookResponse(
                status="ignored",
                action_type=classification.action_type,
                detail="Mensagem classificada como bate-papo.",
            )

        list_id = self.list_id_for(classification.action_type)
        if not list_id:
            raise ValueError(
                f"nenhuma lista configurada para '{classification.action_type.value}'"
            )

        card = self.trello.create_card(
            list_id=list_id,
            name=classification.title,
            description=_render_description(classification, message),
            due=classification.due_date,
        )
        url = card.get("shortUrl") or card.get("url")
        prazo = f" · prazo {classification.due_date}" if classification.due_date else ""
        log.info("%s %s%s", green("Cartão criado:"), classification.title, dim(prazo))
        log.info("%s", dim(f"   {url}"))

        return WebhookResponse(
            status="created",
            action_type=classification.action_type,
            title=classification.title,
            card_url=url,
            card_id=card.get("id"),
            due_date=classification.due_date,
        )


def _render_description(classification: Classification, message: WebhookMessage) -> str:
    """Descrição do cartão em markdown, preservando a mensagem original —
    o time precisa conseguir auditar o que a IA leu."""
    partes = [classification.description.strip()]
    origem = []
    if message.sender:
        origem.append(f"**Autor:** {message.sender}")
    if message.group:
        origem.append(f"**Grupo:** {message.group}")
    if origem:
        partes.append(" · ".join(origem))
    partes.append(f"---\n**Mensagem original:**\n> {message.text.strip()}")
    partes.append("_Cartão gerado automaticamente pelo Cérebro de Operações._")
    return "\n\n".join(part for part in partes if part)


def build_pipeline(settings: Settings) -> Pipeline:
    """Monta o pipeline de produção (Gemini real + Trello real)."""
    from .gemini import GeminiAnalyzer  # import tardio: mantém os testes leves

    return Pipeline(
        settings=settings,
        analyzer=GeminiAnalyzer(settings),
        trello=TrelloClient(
            settings.trello_api_key,
            settings.trello_token,
            timeout=settings.request_timeout,
        ),
    )
