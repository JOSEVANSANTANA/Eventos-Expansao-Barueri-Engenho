from __future__ import annotations

from types import SimpleNamespace

import pytest

import cerebro.estudio as estudio_module
from cerebro.estudio import EstudioCriativo
from cerebro.gemini import GeminiAnalysisError

IDEIAS_JSON = """{"ideias": [
  {"title": "Série de reels com testemunhos da Vigília",
   "description": "Três cortes verticais com respostas curtas de quem participou.",
   "formato": "Reels", "esforco": "baixo", "due_date": "2026-08-20"},
  {"title": "Carrossel com a programação da semana",
   "description": "Arte estática com horários dos cultos.",
   "formato": "Carrossel", "esforco": "baixo", "due_date": null}
]}"""

ORGANIZAR_JSON = """{
  "resumo": "O board tem muita ideia parada e poucas tarefas com prazo.",
  "prioridades": [
    {"titulo": "Gravar vídeos da Vigília", "motivo": "É neste domingo.", "urgencia": "alta"}
  ],
  "duplicatas": [
    {"titulos": ["Paleta da Vigília", "Cores da Vigília"], "sugestao": "Fundir em um cartão."}
  ],
  "lacunas": ["Nenhum cartão sobre a campanha de arrecadação"],
  "proximos_passos": ["Definir responsável pelo roteiro"]
}"""


class FakeModel:
    def __init__(self, *saidas) -> None:
        self.saidas = list(saidas)
        self.prompts: list[str] = []

    def generate_content(self, prompt: str):
        self.prompts.append(prompt)
        saida = self.saidas.pop(0) if self.saidas else ""
        if isinstance(saida, Exception):
            raise saida
        return SimpleNamespace(text=saida, prompt_feedback=None)


@pytest.fixture
def estudio(settings, monkeypatch):
    """Instala um SDK falso e devolve (estúdio, modelos criados)."""

    def _montar(*saidas):
        modelos: list[FakeModel] = []

        def _factory(**kwargs):
            modelo = FakeModel(*saidas)
            modelo.kwargs = kwargs
            modelos.append(modelo)
            return modelo

        monkeypatch.setattr(
            estudio_module,
            "genai",
            SimpleNamespace(configure=lambda **kw: None, GenerativeModel=_factory),
        )
        return EstudioCriativo(settings), modelos

    return _montar


# ---------------------------------------------------------------- gerar ideias
def test_gera_ideias_estruturadas(estudio):
    criativo, _ = estudio(IDEIAS_JSON)

    ideias = criativo.gerar_ideias("Vigília de sexta", quantidade=2)

    assert len(ideias) == 2
    assert ideias[0].title.startswith("Série de reels")
    assert ideias[0].formato == "Reels"
    assert ideias[0].esforco == "baixo"
    # Data normalizada para o formato que o Trello aceita.
    assert ideias[0].due_date == "2026-08-20T15:00:00.000Z"
    assert ideias[1].due_date is None


def test_prompt_leva_o_board_como_contexto(estudio):
    criativo, modelos = estudio(IDEIAS_JSON)

    criativo.gerar_ideias("Vigília", contexto=["Paleta de cores da Vigília"])

    prompt = modelos[0].prompts[0]
    assert "Paleta de cores da Vigília" in prompt
    assert "Data de referência" in prompt
    assert "NÃO repita" in prompt


def test_board_vazio_nao_quebra_o_prompt(estudio):
    criativo, modelos = estudio(IDEIAS_JSON)
    criativo.gerar_ideias("Tema qualquer", contexto=[])
    assert "(board vazio)" in modelos[0].prompts[0]


def test_quantidade_e_limitada(estudio):
    criativo, modelos = estudio(IDEIAS_JSON)
    criativo.gerar_ideias("Tema", quantidade=99)
    assert "Gere 10 ideias" in modelos[0].prompts[0]


def test_ideia_sem_titulo_e_descartada(estudio):
    criativo, _ = estudio('{"ideias": [{"title": "", "description": "x"}, {"title": "Boa"}]}')
    ideias = criativo.gerar_ideias("Tema")
    assert [i.title for i in ideias] == ["Boa"]


def test_resposta_sem_a_chave_ideias_devolve_lista_vazia(estudio):
    criativo, _ = estudio('{"resultado": []}')
    assert criativo.gerar_ideias("Tema") == []


def test_json_invalido_vira_erro_de_analise(estudio):
    criativo, _ = estudio("desculpe, não consegui")
    with pytest.raises(GeminiAnalysisError):
        criativo.gerar_ideias("Tema")


def test_temperatura_de_criacao_e_maior_que_a_de_analise(estudio):
    _, modelos = estudio(IDEIAS_JSON)
    criativa, analitica = modelos[0].kwargs, modelos[1].kwargs
    assert criativa["generation_config"]["temperature"] > (
        analitica["generation_config"]["temperature"]
    )
    assert criativa["generation_config"]["response_mime_type"] == "application/json"


# ------------------------------------------------------------------- organizar
def test_organiza_o_board(estudio):
    criativo, modelos = estudio(ORGANIZAR_JSON, ORGANIZAR_JSON)

    analise = criativo.organizar(
        ideias=[{"name": "Paleta da Vigília"}, {"name": "Cores da Vigília"}],
        tarefas=[{"name": "Gravar vídeos da Vigília", "due": "2026-08-16T15:00:00.000Z"}],
    )

    assert "muita ideia parada" in analise["resumo"]
    assert analise["prioridades"][0]["urgencia"] == "alta"
    assert analise["duplicatas"][0]["titulos"] == ["Paleta da Vigília", "Cores da Vigília"]
    assert analise["lacunas"] == ["Nenhum cartão sobre a campanha de arrecadação"]


def test_organizar_envia_os_cartoes_com_prazo_no_prompt(estudio):
    criativo, modelos = estudio(ORGANIZAR_JSON, ORGANIZAR_JSON)

    criativo.organizar(
        ideias=[], tarefas=[{"name": "Gravar vídeos", "due": "2026-08-16T15:00:00.000Z"}]
    )

    prompt = modelos[1].prompts[0]  # o segundo modelo é o analítico
    assert "Gravar vídeos (prazo 2026-08-16)" in prompt
    assert "(coluna vazia)" in prompt


def test_organizar_tolera_campos_ausentes(estudio):
    criativo, _ = estudio('{"resumo": "ok"}', '{"resumo": "ok"}')
    analise = criativo.organizar(ideias=[], tarefas=[])
    assert analise == {
        "resumo": "ok", "prioridades": [], "duplicatas": [],
        "lacunas": [], "proximos_passos": [],
    }
