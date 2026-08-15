from __future__ import annotations

from types import SimpleNamespace

import pytest

import cerebro.gemini as gemini_module
from cerebro.gemini import GeminiAnalysisError, GeminiAnalyzer, _parse_json
from cerebro.models import ActionType, WebhookMessage


class FakeModel:
    """Modelo falso: devolve textos ou levanta exceções, na ordem programada."""

    def __init__(self, *outcomes) -> None:
        self.outcomes = list(outcomes)
        self.prompts: list[str] = []

    def generate_content(self, prompt: str):
        self.prompts.append(prompt)
        outcome = self.outcomes.pop(0) if self.outcomes else ""
        if isinstance(outcome, Exception):
            raise outcome
        return SimpleNamespace(text=outcome, prompt_feedback=None)


@pytest.fixture
def fake_genai(monkeypatch):
    """Substitui o SDK por um dublê e expõe o modelo/kwargs capturados."""
    estado: dict = {}

    def _install(*outcomes):
        model = FakeModel(*outcomes)

        def _factory(**kwargs):
            estado["kwargs"] = kwargs
            return model

        monkeypatch.setattr(
            gemini_module,
            "genai",
            SimpleNamespace(
                configure=lambda **kw: estado.update(configured=kw),
                GenerativeModel=_factory,
            ),
        )
        estado["model"] = model
        return estado

    return _install


MENSAGEM = WebhookMessage(
    text="Letícia vai fazer o roteiro hoje.", sender="Vando", group="EXPANSAO OSASCO"
)


# ------------------------------------------------------------------ _parse_json
def test_parse_json_simples():
    assert _parse_json('{"action_type": "tarefa"}') == {"action_type": "tarefa"}


def test_parse_json_com_cerca_de_markdown():
    bruto = '```json\n{"action_type": "ideia", "title": "X"}\n```'
    assert _parse_json(bruto)["action_type"] == "ideia"


def test_parse_json_com_texto_ao_redor():
    bruto = 'Claro! Aqui está:\n{"action_type": "tarefa", "title": "X"}\nEspero ter ajudado.'
    assert _parse_json(bruto)["title"] == "X"


def test_parse_json_invalido_levanta_erro():
    with pytest.raises(GeminiAnalysisError, match="não é JSON válido"):
        _parse_json("desculpe, não consegui")


def test_parse_json_lista_e_rejeitada():
    with pytest.raises(GeminiAnalysisError, match="esperado objeto JSON"):
        _parse_json('["tarefa"]')


# -------------------------------------------------------------- GeminiAnalyzer
def test_analyze_devolve_classificacao_normalizada(settings, fake_genai):
    estado = fake_genai(
        '{"action_type": "TAREFA", "title": "Escrever roteiro da Vigília", '
        '"description": "Letícia escreve hoje.", "due_date": "2026-08-16"}'
    )
    analyzer = GeminiAnalyzer(settings)

    resultado = analyzer.analyze(MENSAGEM)

    assert resultado.action_type is ActionType.TAREFA
    assert resultado.title == "Escrever roteiro da Vigília"
    assert resultado.due_date == "2026-08-16T15:00:00.000Z"
    assert estado["configured"]["api_key"] == "fake-gemini-key"


def test_modelo_configurado_com_json_e_system_prompt(settings, fake_genai):
    estado = fake_genai('{"action_type": "ignorar"}')
    GeminiAnalyzer(settings)

    kwargs = estado["kwargs"]
    assert kwargs["model_name"] == "gemini-1.5-flash"
    assert kwargs["generation_config"]["response_mime_type"] == "application/json"
    assert "Gerente de Projetos" in kwargs["system_instruction"]


def test_prompt_inclui_data_de_referencia_autor_e_grupo(settings, fake_genai):
    estado = fake_genai('{"action_type": "ignorar"}')
    GeminiAnalyzer(settings).analyze(MENSAGEM)

    prompt = estado["model"].prompts[0]
    assert "Data de referência" in prompt
    assert "EXPANSAO OSASCO" in prompt
    assert "Vando" in prompt
    assert MENSAGEM.text in prompt


def test_falha_transitoria_e_repetida(settings, fake_genai, monkeypatch):
    monkeypatch.setattr(gemini_module.time, "sleep", lambda _: None)
    estado = fake_genai(RuntimeError("503 service unavailable"), '{"action_type": "ideia"}')

    resultado = GeminiAnalyzer(settings).analyze(MENSAGEM)

    assert resultado.action_type is ActionType.IDEIA
    assert len(estado["model"].prompts) == 2


def test_erro_de_credencial_nao_e_repetido(settings, fake_genai, monkeypatch):
    monkeypatch.setattr(gemini_module.time, "sleep", lambda _: None)
    estado = fake_genai(RuntimeError("API key not valid"), '{"action_type": "ideia"}')

    with pytest.raises(GeminiAnalysisError, match="API key"):
        GeminiAnalyzer(settings).analyze(MENSAGEM)
    assert len(estado["model"].prompts) == 1


def test_resposta_vazia_vira_erro_de_analise(settings, fake_genai, monkeypatch):
    monkeypatch.setattr(gemini_module.time, "sleep", lambda _: None)
    fake_genai("", "")
    with pytest.raises(GeminiAnalysisError):
        GeminiAnalyzer(settings).analyze(MENSAGEM)
