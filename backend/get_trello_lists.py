#!/usr/bin/env python3
"""Mapeia os Boards e Listas do Trello e imprime os IDs prontos para o .env.

Uso:
    python get_trello_lists.py                # todos os boards abertos
    python get_trello_lists.py "EXPANSAO"     # filtra por nome do board

Só lê dados — nenhum cartão é criado ou alterado.
"""

from __future__ import annotations

import sys

from cerebro.config import ConfigError, load_trello_credentials
from cerebro.console import bold, cyan, dim, green, red, yellow
from cerebro.models import strip_accents
from cerebro.trello import TrelloClient, TrelloError

# Palavras que indicam a coluna de destino de cada tipo de cartão.
PISTAS_IDEIAS = ("ideia", "referencia", "inspiracao", "banco", "backlog")
PISTAS_TAREFAS = ("tarefa", "fazer", "todo", "to do", "produzir", "execucao", "afazeres")


def _slug(texto: str) -> str:
    return strip_accents(texto).lower()


def _palpite(nome_lista: str) -> str | None:
    slug = _slug(nome_lista)
    if any(pista in slug for pista in PISTAS_IDEIAS):
        return "TRELLO_LIST_ID_IDEIAS"
    if any(pista in slug for pista in PISTAS_TAREFAS):
        return "TRELLO_LIST_ID_TAREFAS"
    return None


def main(argv: list[str]) -> int:
    filtro = _slug(argv[1]) if len(argv) > 1 else ""

    try:
        api_key, token = load_trello_credentials()
    except ConfigError as exc:
        print(red(f"✕ {exc}"))
        return 1

    client = TrelloClient(api_key, token)

    try:
        eu = client.me()
        print(f"\n{green('✓')} Conectado como {bold(eu.get('fullName') or eu.get('username', '?'))}")
        boards = client.list_boards()
    except TrelloError as exc:
        print(red(f"✕ {exc}"))
        return 1

    if filtro:
        boards = [b for b in boards if filtro in _slug(b.get("name", ""))]

    if not boards:
        print(yellow("Nenhum board encontrado para esse filtro."))
        return 1

    sugestoes: dict[str, tuple[str, str]] = {}

    for board in boards:
        print(f"\n{cyan('▸ BOARD')} {bold(board.get('name', 'sem nome'))}")
        print(dim(f"  id: {board['id']}  ·  {board.get('url', '')}"))
        try:
            listas = client.list_lists(board["id"])
        except TrelloError as exc:
            print(red(f"  ✕ não foi possível ler as listas: {exc}"))
            continue
        if not listas:
            print(dim("  (board sem listas abertas)"))
            continue
        for lista in listas:
            nome = lista.get("name", "sem nome")
            chave = _palpite(nome)
            marca = f"  {green('← ' + chave)}" if chave else ""
            print(f"  • {nome:<32} {bold(lista['id'])}{marca}")
            if chave and chave not in sugestoes:
                sugestoes[chave] = (lista["id"], f"{board.get('name')} / {nome}")

    print(f"\n{cyan('─' * 58)}")
    if sugestoes:
        print(bold("Cole no seu .env:\n"))
        for chave in ("TRELLO_LIST_ID_IDEIAS", "TRELLO_LIST_ID_TAREFAS"):
            if chave in sugestoes:
                valor, origem = sugestoes[chave]
                print(f"{chave}={valor}   {dim('# ' + origem)}")
            else:
                print(f"{chave}=      {dim('# escolha o id da lista acima')}")
    else:
        print(
            yellow(
                "Nenhum palpite automático. Copie manualmente os IDs das duas colunas\n"
                "que você quer usar para IDEIAS e TAREFAS."
            )
        )
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
