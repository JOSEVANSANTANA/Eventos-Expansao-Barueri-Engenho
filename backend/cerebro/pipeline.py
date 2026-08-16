"""Orquestração: mensagem → classificação (Gemini) → cartão (Trello).

O pipeline é por área de trabalho: as listas de destino e o cliente do Trello
já vêm resolvidos para a área certa, então esta camada não sabe (nem precisa
saber) de onde a configuração veio.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from .config import Settings
from .console import bold, dim, green, log, yellow
from .models import ActionType, Classification, WebhookMessage, WebhookResponse
from .trello import TrelloClient
from .workspaces import Area


class Analyzer(Protocol):
    """Contrato mínimo da camada de IA — permite injetar um dublê nos testes."""

    def analyze(self, message: WebhookMessage) -> Classification: ...


@dataclass(frozen=True)
class Pipeline:
    analyzer: Analyzer
    trello: TrelloClient
    list_ideias: str
    list_tarefas: str
    area_nome: str = ""
    area_id: int | None = None

    def list_id_for(self, action: ActionType) -> str | None:
        return {
            ActionType.IDEIA: self.list_ideias,
            ActionType.TAREFA: self.list_tarefas,
        }.get(action) or None

    def process(self, message: WebhookMessage) -> WebhookResponse:
        origem = f" [{message.group}]" if message.group else ""
        autor = f"{message.sender}: " if message.sender else ""
        area = f" → {self.area_nome}" if self.area_nome else ""
        log.info("Mensagem recebida%s%s — %s%s", dim(origem), dim(area), autor, message.preview())

        classification = self.analyzer.analyze(message)
        log.info("Gemini classificou como %s", bold(classification.action_type.value.upper()))

        if not classification.actionable:
            log.info("%s", yellow("Bate-papo — nada a criar no Trello."))
            return WebhookResponse(
                status="ignored",
                action_type=classification.action_type,
                area=self.area_nome or None,
                detail="Mensagem classificada como bate-papo.",
            )

        list_id = self.list_id_for(classification.action_type)
        if not list_id:
            raise ValueError(
                f"nenhuma lista configurada para '{classification.action_type.value}'"
                + (f" na área {self.area_nome}" if self.area_nome else "")
            )

        card = self.trello.create_card(
            list_id=list_id,
            name=classification.title,
            description=_render_description(classification, message, self.area_nome),
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
            area=self.area_nome or None,
        )


def _render_description(
    classification: Classification, message: WebhookMessage, area_nome: str = ""
) -> str:
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
    rodape = "_Cartão gerado automaticamente pelo Cérebro de Operações"
    partes.append(f"{rodape} ({area_nome})._" if area_nome else f"{rodape}._")
    return "\n\n".join(part for part in partes if part)


def build_pipeline(settings: Settings, area: Area) -> Pipeline:
    """Monta o pipeline de produção de uma área (Gemini real + Trello real)."""
    from .gemini import GeminiAnalyzer  # import tardio: mantém os testes leves

    chave, token = area.credenciais(settings.trello_api_key, settings.trello_token)
    return Pipeline(
        analyzer=GeminiAnalyzer(settings),
        trello=TrelloClient(chave, token, timeout=settings.request_timeout),
        list_ideias=area.list_ideias,
        list_tarefas=area.list_tarefas,
        area_nome=area.nome,
        area_id=area.id,
    )
