from __future__ import annotations

import pytest

from cerebro.config import ConfigError, load_settings, write_env_values

BASE = """\
# Comentário que deve sobreviver
GEMINI_API_KEY=chave-gemini
TRELLO_API_KEY=chave-trello
TRELLO_TOKEN=token-trello

TRELLO_LIST_ID_IDEIAS=preencher_depois
TRELLO_LIST_ID_TAREFAS=preencher_depois
"""


@pytest.fixture
def env_file(tmp_path):
    caminho = tmp_path / ".env"
    caminho.write_text(BASE, encoding="utf-8")
    return caminho


def test_listas_sao_opcionais_por_padrao(env_file, monkeypatch):
    monkeypatch.delenv("TRELLO_LIST_ID_IDEIAS", raising=False)
    monkeypatch.delenv("TRELLO_LIST_ID_TAREFAS", raising=False)

    settings = load_settings(env_path=env_file)

    assert settings.trello_api_key == "chave-trello"
    assert settings.trello_list_id_ideias == ""  # placeholder vira vazio, não erro


def test_listas_obrigatorias_quando_exigidas(env_file, monkeypatch):
    monkeypatch.delenv("TRELLO_LIST_ID_IDEIAS", raising=False)
    with pytest.raises(ConfigError, match="TRELLO_LIST_ID_IDEIAS"):
        load_settings(env_path=env_file, require_lists=True)


def test_credencial_ausente_e_erro_com_caminho_do_arquivo(tmp_path, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    vazio = tmp_path / ".env"
    vazio.write_text("TRELLO_API_KEY=x\nTRELLO_TOKEN=y\n", encoding="utf-8")
    with pytest.raises(ConfigError, match="GEMINI_API_KEY"):
        load_settings(env_path=vazio)


def test_write_env_values_atualiza_no_lugar(env_file):
    write_env_values(
        {"TRELLO_LIST_ID_IDEIAS": "abc123456", "TRELLO_LIST_ID_TAREFAS": "def789012"},
        env_path=env_file,
    )
    conteudo = env_file.read_text(encoding="utf-8")

    assert "TRELLO_LIST_ID_IDEIAS=abc123456" in conteudo
    assert "TRELLO_LIST_ID_TAREFAS=def789012" in conteudo
    assert "preencher_depois" not in conteudo
    assert "# Comentário que deve sobreviver" in conteudo
    assert "GEMINI_API_KEY=chave-gemini" in conteudo


def test_write_env_values_acrescenta_chave_nova(env_file):
    write_env_values({"PORT": "8123"}, env_path=env_file)
    assert "PORT=8123" in env_file.read_text(encoding="utf-8")


def test_write_env_values_cria_arquivo_inexistente(tmp_path):
    destino = tmp_path / "novo.env"
    write_env_values({"PORT": "9000"}, env_path=destino)
    assert destino.read_text(encoding="utf-8") == "PORT=9000\n"


def test_settings_recarregadas_refletem_o_arquivo(env_file, monkeypatch):
    monkeypatch.delenv("TRELLO_LIST_ID_IDEIAS", raising=False)
    monkeypatch.delenv("TRELLO_LIST_ID_TAREFAS", raising=False)

    write_env_values(
        {"TRELLO_LIST_ID_IDEIAS": "id_ideias", "TRELLO_LIST_ID_TAREFAS": "id_tarefas"},
        env_path=env_file,
    )
    settings = load_settings(env_path=env_file, override=True)

    assert settings.trello_list_id_ideias == "id_ideias"
    assert settings.trello_list_id_tarefas == "id_tarefas"
