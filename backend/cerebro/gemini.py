"""Camada de IA: o Gerente de Projetos que lê a mensagem e devolve JSON."""

from __future__ import annotations

import json
import time
from typing import Any

import google.generativeai as genai

from .config import Settings
from .console import log
from .models import Classification, WebhookMessage, today_reference

SYSTEM_PROMPT = """Você atua como um Gerente de Projetos de uma equipe criativa de igreja. \
Analise as mensagens recebidas e classifique-as. Retorne ESTRITAMENTE um JSON estruturado \
com as chaves:
- `action_type`: "ideia" (para referências), "tarefa" (para decisões) ou "ignorar" (bate-papo).
- `title`: Título executivo curto para o cartão Trello.
- `description`: Contexto completo da atividade.
- `due_date`: Data de entrega (em formato string ISO), se extraível do texto.

Regras de execução:
1. Responda apenas com o objeto JSON, sem markdown, sem comentários, sem texto ao redor.
2. As quatro chaves são obrigatórias. Use `null` em `due_date` quando o texto não permitir \
inferir uma data. Quando `action_type` for "ignorar", use string vazia em `title` e `description`.
3. `title` tem no máximo 80 caracteres, começa por verbo ou pelo entregável e não repete a \
mensagem inteira.
4. `description` preserva nomes de pessoas, local, evento e responsabilidades citados na mensagem.
5. `due_date` usa ISO 8601 (`AAAA-MM-DD` ou `AAAA-MM-DDTHH:MM:SS`). Resolva expressões \
relativas ("hoje", "amanhã", "neste domingo") a partir da data de referência informada.
6. Na dúvida entre "ideia" e "tarefa": há responsável, prazo ou decisão fechada -> "tarefa"; \
é referência, inspiração ou material de apoio -> "ideia".
"""

# Esquema declarado para o modelo — reduz variação de formato entre chamadas.
RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "action_type": {"type": "string", "enum": ["ideia", "tarefa", "ignorar"]},
        "title": {"type": "string"},
        "description": {"type": "string"},
        "due_date": {"type": "string", "nullable": True},
    },
    "required": ["action_type", "title", "description"],
}

_FATAL_MARKERS = ("api key", "permission", "unauthenticated", "invalid argument", "not found")


class GeminiAnalysisError(RuntimeError):
    """Falha ao obter uma classificação utilizável do Gemini."""


class GeminiAnalyzer:
    """Encapsula o SDK oficial e devolve sempre uma `Classification` válida."""

    def __init__(self, settings: Settings, *, max_attempts: int = 2) -> None:
        self._timezone = settings.timezone
        self._model_name = settings.gemini_model
        self._max_attempts = max(1, max_attempts)
        genai.configure(api_key=settings.gemini_api_key)
        self._model = genai.GenerativeModel(
            model_name=settings.gemini_model,
            system_instruction=SYSTEM_PROMPT,
            generation_config={
                "response_mime_type": "application/json",
                "response_schema": RESPONSE_SCHEMA,
                "temperature": 0.2,
                "max_output_tokens": 1024,
            },
        )

    @property
    def model_name(self) -> str:
        return self._model_name

    def _build_prompt(self, message: WebhookMessage) -> str:
        contexto = [f"Data de referência (hoje): {today_reference(self._timezone)}"]
        if message.group:
            contexto.append(f"Grupo: {message.group}")
        if message.sender:
            contexto.append(f"Autor da mensagem: {message.sender}")
        cabecalho = "\n".join(contexto)
        return f"{cabecalho}\n\nMensagem recebida:\n\"\"\"\n{message.text}\n\"\"\""

    def _generate(self, prompt: str) -> str:
        """Chama o modelo com uma retentativa para falhas transitórias."""
        last_error: Exception | None = None
        for attempt in range(1, self._max_attempts + 1):
            try:
                response = self._model.generate_content(prompt)
                text = (getattr(response, "text", "") or "").strip()
                if not text:
                    raise GeminiAnalysisError(
                        f"resposta vazia do modelo (feedback: "
                        f"{getattr(response, 'prompt_feedback', 'n/d')})"
                    )
                return text
            except Exception as exc:  # noqa: BLE001 — SDK levanta hierarquias distintas
                last_error = exc
                if any(marker in str(exc).lower() for marker in _FATAL_MARKERS):
                    break  # credencial/modelo errado: repetir não resolve
                if attempt < self._max_attempts:
                    log.warning(
                        "Gemini falhou (tentativa %s/%s): %s — repetindo…",
                        attempt,
                        self._max_attempts,
                        exc,
                    )
                    time.sleep(1.5 * attempt)
        raise GeminiAnalysisError(f"chamada ao Gemini falhou: {last_error}") from last_error

    def analyze(self, message: WebhookMessage) -> Classification:
        raw = self._generate(self._build_prompt(message))
        payload = _parse_json(raw)
        return Classification.from_payload(
            payload, fallback_text=message.text, timezone=self._timezone
        )


def _parse_json(raw: str) -> dict[str, Any]:
    """Decodifica a resposta do modelo, tolerando cercas de markdown ocasionais."""
    text = raw.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if "\n" in text:
            first, _, rest = text.partition("\n")
            if first.strip().lower() in {"json", ""}:
                text = rest
        text = text.strip()
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end <= start:
            raise GeminiAnalysisError(f"resposta não é JSON válido: {raw[:200]}") from exc
        try:
            payload = json.loads(text[start : end + 1])
        except json.JSONDecodeError as inner:
            raise GeminiAnalysisError(f"resposta não é JSON válido: {raw[:200]}") from inner
    if not isinstance(payload, dict):
        raise GeminiAnalysisError(f"esperado objeto JSON, recebido {type(payload).__name__}")
    return payload
