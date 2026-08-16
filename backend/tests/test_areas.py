"""Áreas de trabalho, credenciais próprias e vínculos com grupos/contatos."""

from __future__ import annotations

import pytest

from cerebro.workspaces import AreaError, AreaStore, normalizar


# ------------------------------------------------------------------------ CRUD
def test_primeira_area_vira_padrao(areas):
    primeira = areas.criar("Mídia")
    segunda = areas.criar("Louvor")

    assert primeira.padrao is True
    assert segunda.padrao is False
    assert areas.padrao().id == primeira.id


def test_nome_duplicado_e_recusado(areas):
    areas.criar("Mídia")
    with pytest.raises(AreaError, match="Já existe"):
        areas.criar("mídia")  # mesma área, caixa diferente


def test_nome_muito_curto_e_recusado(areas):
    with pytest.raises(AreaError, match="pelo menos 2"):
        areas.criar("X")


def test_atualizar_campos(areas):
    area = areas.criar("Mídia")
    atualizada = areas.atualizar(
        area.id, board_id="b1", board_nome="Board", list_ideias="l1", list_tarefas="l2"
    )
    assert atualizada.board_nome == "Board"
    assert atualizada.pronta is True


def test_area_sem_listas_nao_esta_pronta(areas):
    assert areas.criar("Mídia").pronta is False


def test_campo_desconhecido_e_recusado(areas):
    area = areas.criar("Mídia")
    with pytest.raises(AreaError, match="campos desconhecidos"):
        areas.atualizar(area.id, cor_favorita="azul")


def test_definir_padrao_troca_a_anterior(areas):
    primeira = areas.criar("Mídia")
    segunda = areas.criar("Louvor")

    areas.definir_padrao(segunda.id)

    assert areas.obter(primeira.id).padrao is False
    assert areas.padrao().id == segunda.id


def test_remover_area_promove_outra_a_padrao(areas):
    primeira = areas.criar("Mídia")
    segunda = areas.criar("Louvor")

    areas.remover(primeira.id)

    assert areas.padrao().id == segunda.id
    with pytest.raises(AreaError, match="não encontrada"):
        areas.obter(primeira.id)


def test_remover_area_leva_os_vinculos_junto(areas):
    area = areas.criar("Mídia")
    areas.vincular(area.id, "GRUPO MÍDIA")
    areas.remover(area.id)
    assert areas.vinculos() == []


# ---------------------------------------------------------------- credenciais
def test_credenciais_proprias_tem_prioridade(areas):
    area = areas.criar("Outra Org", trello_key="chave-propria", trello_token="token-proprio")
    assert area.credenciais("global-k", "global-t") == ("chave-propria", "token-proprio")
    assert area.usa_credencial_propria() is True


def test_sem_credencial_propria_herda_a_global(areas):
    area = areas.criar("Mídia")
    assert area.credenciais("global-k", "global-t") == ("global-k", "global-t")
    assert area.usa_credencial_propria() is False


def test_segredo_nao_vaza_no_json_por_padrao(areas):
    area = areas.criar("Mídia", trello_key="k", trello_token="t", trello_secret="s")
    assert "trello_token" not in area.to_dict()
    assert area.to_dict(com_segredos=True)["trello_secret"] == "s"


# ------------------------------------------------------------------- vínculos
def test_vincular_e_resolver_por_grupo(areas):
    area = areas.criar("Mídia", list_ideias="a", list_tarefas="b")
    areas.vincular(area.id, "EXPANSAO OSASCO")

    assert areas.resolver(grupo="EXPANSAO OSASCO").id == area.id


def test_resolucao_ignora_acento_e_caixa(areas):
    area = areas.criar("Mídia")
    areas.vincular(area.id, "Expansão Osasco")

    assert areas.area_de("EXPANSAO OSASCO").id == area.id
    assert areas.area_de("expansao  osasco").id == area.id


def test_um_grupo_aponta_para_uma_area_so(areas):
    midia = areas.criar("Mídia")
    louvor = areas.criar("Louvor")
    areas.vincular(midia.id, "GRUPO GERAL")

    areas.vincular(louvor.id, "GRUPO GERAL")  # reaponta

    assert areas.area_de("GRUPO GERAL").id == louvor.id
    assert len(areas.vinculos()) == 1


def test_vinculo_de_contato_e_separado_do_de_grupo(areas):
    midia = areas.criar("Mídia")
    louvor = areas.criar("Louvor")
    areas.vincular(midia.id, "Lívia", "contato")
    areas.vincular(louvor.id, "Lívia", "grupo")

    assert areas.area_de("Lívia", "contato").id == midia.id
    assert areas.area_de("Lívia", "grupo").id == louvor.id


def test_resolver_prefere_grupo_a_contato(areas):
    grupo_area = areas.criar("Mídia")
    contato_area = areas.criar("Louvor")
    areas.vincular(grupo_area.id, "EXPANSAO OSASCO", "grupo")
    areas.vincular(contato_area.id, "Vando", "contato")

    achada = areas.resolver(grupo="EXPANSAO OSASCO", autor="Vando")

    assert achada.id == grupo_area.id


def test_resolver_cai_no_contato_quando_o_grupo_nao_tem_vinculo(areas):
    area = areas.criar("Mídia")
    areas.vincular(area.id, "Vando", "contato")
    assert areas.resolver(grupo="Grupo Solto", autor="Vando").id == area.id


def test_resolver_cai_na_padrao(areas):
    padrao = areas.criar("Mídia")
    areas.criar("Louvor")
    assert areas.resolver(grupo="Desconhecido").id == padrao.id


def test_resolver_sem_padrao_devolve_none(areas):
    areas.criar("Mídia")
    assert areas.resolver(grupo="X", usar_padrao=False) is None


def test_desvincular_por_identificador(areas):
    area = areas.criar("Mídia")
    areas.vincular(area.id, "EXPANSAO OSASCO")

    assert areas.desvincular(identificador="expansao osasco") is True
    assert areas.resolver(grupo="EXPANSAO OSASCO", usar_padrao=False) is None


def test_desvincular_inexistente_devolve_false(areas):
    assert areas.desvincular(identificador="nada") is False


def test_vinculo_precisa_de_identificador(areas):
    area = areas.criar("Mídia")
    with pytest.raises(AreaError, match="Informe o nome"):
        areas.vincular(area.id, " ")


def test_tipo_invalido_e_recusado(areas):
    area = areas.criar("Mídia")
    with pytest.raises(AreaError, match="grupo.*contato"):
        areas.vincular(area.id, "X", "email")


# --------------------------------------------------------------- busca por nome
def test_busca_por_nome_tolerante(areas):
    area = areas.criar("EXPANSAO OSASCO")
    assert areas.obter_por_nome("expansão osasco").id == area.id
    assert areas.obter_por_nome("  EXPANSAO   OSASCO ").id == area.id


def test_busca_parcial_quando_nao_ha_ambiguidade(areas):
    area = areas.criar("EXPANSAO OSASCO")
    areas.criar("Louvor")
    assert areas.obter_por_nome("osasco").id == area.id


def test_busca_parcial_ambigua_devolve_none(areas):
    areas.criar("Mídia Osasco")
    areas.criar("Louvor Osasco")
    assert areas.obter_por_nome("osasco") is None


def test_busca_por_nome_inexistente(areas):
    assert areas.obter_por_nome("não existe") is None


# ------------------------------------------------------------------- migração
def test_migracao_do_env_cria_a_area_inicial(tmp_path, settings):
    store = AreaStore(tmp_path / "migra.db")
    try:
        area = store.migrar_do_env(settings)
        assert area is not None
        assert area.list_ideias == settings.trello_list_id_ideias
        assert area.padrao is True
        # Não roda de novo depois de já existir área.
        assert store.migrar_do_env(settings) is None
    finally:
        store.close()


def test_migracao_vincula_os_grupos_do_env(tmp_path, settings):
    import dataclasses

    com_grupos = dataclasses.replace(settings, whatsapp_grupos=("EXPANSAO OSASCO", "Mídia"))
    store = AreaStore(tmp_path / "migra2.db")
    try:
        area = store.migrar_do_env(com_grupos)
        vinculados = {v.identificador for v in store.vinculos(area.id)}
        assert vinculados == {"EXPANSAO OSASCO", "Mídia"}
    finally:
        store.close()


def test_migracao_sem_listas_no_env_nao_cria_nada(tmp_path, settings):
    import dataclasses

    vazio = dataclasses.replace(settings, trello_list_id_ideias="", trello_list_id_tarefas="")
    store = AreaStore(tmp_path / "migra3.db")
    try:
        assert store.migrar_do_env(vazio) is None
        assert store.listar() == []
    finally:
        store.close()


def test_dados_sobrevivem_a_reabertura(tmp_path):
    caminho = tmp_path / "persistente.db"
    primeiro = AreaStore(caminho)
    area = primeiro.criar("Mídia", list_ideias="a", list_tarefas="b")
    primeiro.vincular(area.id, "EXPANSAO OSASCO")
    primeiro.close()

    segundo = AreaStore(caminho)
    try:
        assert segundo.area_de("expansao osasco").nome == "Mídia"
    finally:
        segundo.close()


def test_normalizar():
    assert normalizar("Expansão  OSASCO ") == "expansao osasco"
    assert normalizar("") == ""
