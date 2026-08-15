"""Estúdio Criativo — usa a mesma chave do Gemini para produzir, não só classificar.

Três capacidades, todas com saída em JSON:
  · gerar_ideias   — pauta nova a partir de um tema, ciente do que já existe no board;
  · organizar      — lê o board e devolve prioridades, duplicatas e lacunas;
  · pauta_semanal  — resumo executivo da semana para a reunião de equipe.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import google.generativeai as genai

from .config import Settings
from .gemini import gerar_texto, parse_json
from .models import normalize_due_date, today_reference

SYSTEM_PROMPT = """Você é o Diretor de Criação de uma equipe de mídia de igreja \
(fotografia, vídeo, social media e transmissão de cultos). Você conhece a rotina: cultos \
de domingo, vigílias, ceias, células, eventos de jovens, campanhas de arrecadação, \
datas do calendário cristão e as plataformas onde a igreja publica (Instagram, YouTube, \
WhatsApp, TikTok).

Regras invioláveis:
1. Responda SEMPRE e SOMENTE com um objeto JSON válido, sem markdown e sem texto ao redor.
2. Escreva em português do Brasil, com linguagem de equipe — direta, sem jargão corporativo.
3. Proponha coisas executáveis por uma equipe pequena e voluntária: nada que exija \
orçamento alto, equipamento de cinema ou semanas de produção.
4. Respeite o tom de uma igreja: acolhedor, respeitoso, sem sensacionalismo e sem \
promessas que a equipe não pode cumprir.
5. Nunca invente fatos sobre pessoas, datas ou eventos que não estejam no contexto dado.
"""

ESQUEMA_IDEIAS = {
    "type": "object",
    "properties": {
        "ideias": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "description": {"type": "string"},
                    "formato": {"type": "string"},
                    "esforco": {"type": "string", "enum": ["baixo", "medio", "alto"]},
                    "due_date": {"type": "string", "nullable": True},
                },
                "required": ["title", "description", "formato"],
            },
        }
    },
    "required": ["ideias"],
}

ESQUEMA_ORGANIZACAO = {
    "type": "object",
    "properties": {
        "resumo": {"type": "string"},
        "prioridades": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "titulo": {"type": "string"},
                    "motivo": {"type": "string"},
                    "urgencia": {"type": "string", "enum": ["alta", "media", "baixa"]},
                },
                "required": ["titulo", "motivo", "urgencia"],
            },
        },
        "duplicatas": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "titulos": {"type": "array", "items": {"type": "string"}},
                    "sugestao": {"type": "string"},
                },
                "required": ["titulos", "sugestao"],
            },
        },
        "lacunas": {"type": "array", "items": {"type": "string"}},
        "proximos_passos": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["resumo", "prioridades"],
}


@dataclass(frozen=True)
class Ideia:
    title: str
    description: str
    formato: str = ""
    esforco: str = ""
    due_date: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "title": self.title,
            "description": self.description,
            "formato": self.formato,
            "esforco": self.esforco,
            "due_date": self.due_date,
        }


class EstudioCriativo:
    """Camada criativa do Gemini — separada do classificador, mesma credencial."""

    def __init__(self, settings: Settings, *, max_attempts: int = 2) -> None:
        self._timezone = settings.timezone
        self._max_attempts = max_attempts
        genai.configure(api_key=settings.gemini_api_key)
        self._model = genai.GenerativeModel(
            model_name=settings.gemini_model,
            system_instruction=SYSTEM_PROMPT,
            generation_config={
                "response_mime_type": "application/json",
                "temperature": 0.9,  # criação pede mais variedade que classificação
                "max_output_tokens": 2048,
            },
        )
        self._model_estruturado = genai.GenerativeModel(
            model_name=settings.gemini_model,
            system_instruction=SYSTEM_PROMPT,
            generation_config={
                "response_mime_type": "application/json",
                "temperature": 0.3,  # análise pede consistência
                "max_output_tokens": 2048,
            },
        )

    # ------------------------------------------------------------------ ideias
    def gerar_ideias(
        self,
        tema: str,
        *,
        quantidade: int = 5,
        contexto: list[str] | None = None,
    ) -> list[Ideia]:
        quantidade = max(1, min(quantidade, 10))
        existentes = "\n".join(f"- {item}" for item in (contexto or [])[:40])
        prompt = f"""Data de referência (hoje): {today_reference(self._timezone)}

Tema pedido pela equipe: {tema.strip()}

Já existe no board (NÃO repita nem proponha variações rasas destes):
{existentes or "- (board vazio)"}

Gere {quantidade} ideias de conteúdo novas para a equipe de mídia.
Formato do JSON: {{"ideias": [{{"title", "description", "formato", "esforco", "due_date"}}]}}
- `title`: até 70 caracteres, específico o bastante para virar cartão do Trello.
- `description`: o que é, por que vale a pena e como executar em 2 a 4 frases.
- `formato`: o veículo concreto (Reels, carrossel, vídeo curto para YouTube, \
story em sequência, foto para feed, arte estática, transmissão…).
- `esforco`: "baixo", "medio" ou "alto" para uma equipe voluntária.
- `due_date`: ISO 8601 só quando o tema tiver data óbvia; caso contrário, null."""

        payload = parse_json(gerar_texto(self._model, prompt, max_attempts=self._max_attempts))
        brutas = payload.get("ideias") or []
        ideias: list[Ideia] = []
        for bruta in brutas[:quantidade]:
            if not isinstance(bruta, dict):
                continue
            titulo = " ".join(str(bruta.get("title") or "").split())
            if not titulo:
                continue
            ideias.append(
                Ideia(
                    title=titulo[:200],
                    description=str(bruta.get("description") or "").strip(),
                    formato=str(bruta.get("formato") or "").strip()[:60],
                    esforco=str(bruta.get("esforco") or "").strip().lower()[:10],
                    due_date=normalize_due_date(bruta.get("due_date"), timezone=self._timezone),
                )
            )
        return ideias

    # --------------------------------------------------------------- organizar
    def organizar(
        self, ideias: list[dict[str, Any]], tarefas: list[dict[str, Any]]
    ) -> dict[str, Any]:
        """Lê o board e devolve prioridades, duplicatas e lacunas."""

        def _formatar(cartoes: list[dict[str, Any]]) -> str:
            linhas = []
            for card in cartoes[:40]:
                prazo = f" (prazo {card['due'][:10]})" if card.get("due") else ""
                linhas.append(f"- {card.get('name', 'sem título')}{prazo}")
            return "\n".join(linhas) or "- (coluna vazia)"

        prompt = f"""Data de referência (hoje): {today_reference(self._timezone)}

Coluna IDEIAS:
{_formatar(ideias)}

Coluna TAREFAS:
{_formatar(tarefas)}

Analise o board desta equipe de mídia e devolve o JSON:
{{"resumo", "prioridades": [{{"titulo","motivo","urgencia"}}], \
"duplicatas": [{{"titulos": [], "sugestao"}}], "lacunas": [], "proximos_passos": []}}
- `resumo`: 2 a 3 frases sobre o estado real do board.
- `prioridades`: no máximo 5 cartões que precisam de atenção agora, com o porquê. \
Use os títulos exatamente como aparecem acima.
- `duplicatas`: cartões que tratam da mesma coisa e podem ser fundidos (lista vazia se não houver).
- `lacunas`: até 4 coisas que a equipe deveria ter no board e não tem.
- `proximos_passos`: até 4 ações objetivas para esta semana."""

        payload = parse_json(
            gerar_texto(self._model_estruturado, prompt, max_attempts=self._max_attempts)
        )
        return {
            "resumo": str(payload.get("resumo") or "").strip(),
            "prioridades": [
                {
                    "titulo": str(item.get("titulo") or "").strip(),
                    "motivo": str(item.get("motivo") or "").strip(),
                    "urgencia": str(item.get("urgencia") or "media").strip().lower(),
                }
                for item in (payload.get("prioridades") or [])
                if isinstance(item, dict) and item.get("titulo")
            ][:5],
            "duplicatas": [
                {
                    "titulos": [str(t) for t in (item.get("titulos") or [])][:5],
                    "sugestao": str(item.get("sugestao") or "").strip(),
                }
                for item in (payload.get("duplicatas") or [])
                if isinstance(item, dict) and item.get("titulos")
            ][:5],
            "lacunas": [str(item).strip() for item in (payload.get("lacunas") or [])][:4],
            "proximos_passos": [
                str(item).strip() for item in (payload.get("proximos_passos") or [])
            ][:4],
        }
