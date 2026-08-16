"""Comandos que a equipe digita no próprio grupo do WhatsApp.

O objetivo é não precisar abrir o painel para ligar um grupo a uma área do
Trello: basta alguém mandar `START TRELLO EXPANSAO OSASCO` no grupo.

Comandos reconhecidos (com ou sem barra, com ou sem acento, em qualquer caixa):

    START TRELLO <área>     liga este grupo à área informada
    START <área>            idem (atalho)
    PARAR TRELLO            desliga este grupo
    STATUS TRELLO           diz a qual área o grupo está ligado
    AREAS TRELLO            lista as áreas cadastradas
    AJUDA TRELLO            mostra os comandos

Comandos nunca vão para o Gemini: são executados na hora e não viram cartão.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .workspaces import normalizar

VINCULAR = "vincular"
DESVINCULAR = "desvincular"
STATUS = "status"
LISTAR = "listar"
AJUDA = "ajuda"

# Ancorados no início da mensagem: "start" no meio de uma frase não é comando.
_REGRAS: tuple[tuple[str, str, bool], ...] = (
    (r"^(?:start|iniciar|conectar|ligar|vincular)\s+trello\s+(.+)$", VINCULAR, True),
    (r"^(?:start|iniciar|conectar|ligar|vincular)\s+area\s+(.+)$", VINCULAR, True),
    (r"^(?:parar|stop|desconectar|desligar|desvincular)\s+trello$", DESVINCULAR, False),
    (r"^(?:parar|stop|desconectar|desligar|desvincular)\s+area$", DESVINCULAR, False),
    (r"^status\s+(?:trello|area)$", STATUS, False),
    (r"^(?:areas|listar)(?:\s+(?:trello|areas?))?$", LISTAR, False),
    (r"^(?:ajuda|help|comandos)\s+(?:trello|area)$", AJUDA, False),
    # Atalho, avaliado por último para não engolir os anteriores.
    (r"^(?:start|iniciar)\s+(.+)$", VINCULAR, True),
)

_COMPILADAS = tuple((re.compile(padrao), acao, tem_alvo) for padrao, acao, tem_alvo in _REGRAS)


@dataclass(frozen=True)
class Comando:
    acao: str
    alvo: str = ""

    @property
    def precisa_de_alvo(self) -> bool:
        return self.acao == VINCULAR


def interpretar(texto: str) -> Comando | None:
    """Devolve o comando quando a mensagem é um, ou None quando é conversa.

    Só olha a primeira linha: mensagens longas que por acaso começam com uma
    palavra-chave e emendam um texto grande não são comando.
    """
    if not texto:
        return None
    primeira_linha = texto.strip().splitlines()[0] if texto.strip() else ""
    if len(primeira_linha) > 120:
        return None

    limpo = normalizar(primeira_linha.lstrip("/!").strip().rstrip(".!"))
    if not limpo:
        return None

    for padrao, acao, tem_alvo in _COMPILADAS:
        achado = padrao.match(limpo)
        if not achado:
            continue
        if not tem_alvo:
            return Comando(acao)
        # O alvo sai da linha original (com acento e caixa como o usuário digitou).
        alvo_bruto = _recortar_alvo(primeira_linha, achado.group(1))
        return Comando(acao, alvo_bruto)
    return None


def _recortar_alvo(linha_original: str, alvo_normalizado: str) -> str:
    """Recupera o trecho original correspondente ao alvo normalizado.

    Comparar pelo tamanho é suficiente porque `normalizar` só remove acentos e
    colapsa espaços — a contagem de palavras não muda.
    """
    palavras_alvo = len(alvo_normalizado.split())
    palavras = linha_original.strip().lstrip("/!").strip().rstrip(".!").split()
    return " ".join(palavras[-palavras_alvo:]) if palavras_alvo else ""


AJUDA_TEXTO = (
    "Comandos do Cérebro neste grupo:\n"
    "• START TRELLO <área> — liga este grupo a uma área\n"
    "• PARAR TRELLO — desliga este grupo\n"
    "• STATUS TRELLO — mostra a área ligada\n"
    "• AREAS TRELLO — lista as áreas cadastradas"
)
