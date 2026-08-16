"""Áreas de trabalho do Trello e seus vínculos com grupos/contatos do WhatsApp.

Cada área tem board, colunas e — quando necessário — chave e token próprios: no
Trello a credencial é por Power-Up, então áreas de organizações diferentes
costumam exigir chaves diferentes. Quando os campos ficam em branco, a área usa
as credenciais globais do `.env`.

Um grupo (ou contato) do WhatsApp aponta para exatamente uma área. É esse vínculo
que decide em qual board a mensagem vira cartão.
"""

from __future__ import annotations

import sqlite3
import unicodedata
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from threading import Lock
from typing import Any
from zoneinfo import ZoneInfo

ESQUEMA = """
CREATE TABLE IF NOT EXISTS areas (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    nome              TEXT NOT NULL UNIQUE,
    trello_key        TEXT NOT NULL DEFAULT '',
    trello_token      TEXT NOT NULL DEFAULT '',
    trello_secret     TEXT NOT NULL DEFAULT '',
    board_id          TEXT NOT NULL DEFAULT '',
    board_nome        TEXT NOT NULL DEFAULT '',
    list_ideias       TEXT NOT NULL DEFAULT '',
    list_ideias_nome  TEXT NOT NULL DEFAULT '',
    list_tarefas      TEXT NOT NULL DEFAULT '',
    list_tarefas_nome TEXT NOT NULL DEFAULT '',
    padrao            INTEGER NOT NULL DEFAULT 0,
    criada_em         TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS vinculos (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    area_id      INTEGER NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
    tipo         TEXT NOT NULL DEFAULT 'grupo',
    identificador TEXT NOT NULL,
    chave        TEXT NOT NULL UNIQUE,
    criado_em    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vinculos_area ON vinculos(area_id);
"""


class AreaError(RuntimeError):
    """Operação inválida sobre áreas de trabalho ou vínculos."""


def normalizar(texto: str) -> str:
    """Chave de comparação: sem acento, sem caixa, sem espaço duplicado.

    'Expansão Osasco', 'EXPANSAO OSASCO' e 'expansao  osasco' são o mesmo grupo.
    """
    sem_acento = "".join(
        ch for ch in unicodedata.normalize("NFKD", texto or "") if not unicodedata.combining(ch)
    )
    return " ".join(sem_acento.lower().split())


@dataclass(frozen=True)
class Area:
    id: int
    nome: str
    trello_key: str
    trello_token: str
    trello_secret: str
    board_id: str
    board_nome: str
    list_ideias: str
    list_ideias_nome: str
    list_tarefas: str
    list_tarefas_nome: str
    padrao: bool
    criada_em: str

    @property
    def pronta(self) -> bool:
        return bool(self.list_ideias and self.list_tarefas)

    def credenciais(self, chave_global: str = "", token_global: str = "") -> tuple[str, str]:
        """Credenciais efetivas: as próprias quando existem, senão as globais."""
        return (self.trello_key or chave_global, self.trello_token or token_global)

    def usa_credencial_propria(self) -> bool:
        return bool(self.trello_key and self.trello_token)

    def to_dict(self, *, com_segredos: bool = False) -> dict[str, Any]:
        dados = {
            "id": self.id,
            "nome": self.nome,
            "board_id": self.board_id,
            "board_nome": self.board_nome,
            "list_ideias": self.list_ideias,
            "list_ideias_nome": self.list_ideias_nome,
            "list_tarefas": self.list_tarefas,
            "list_tarefas_nome": self.list_tarefas_nome,
            "padrao": self.padrao,
            "pronta": self.pronta,
            "credencial_propria": self.usa_credencial_propria(),
            "criada_em": self.criada_em,
        }
        if com_segredos:
            dados.update(
                trello_key=self.trello_key,
                trello_token=self.trello_token,
                trello_secret=self.trello_secret,
            )
        return dados


@dataclass(frozen=True)
class Vinculo:
    id: int
    area_id: int
    tipo: str
    identificador: str
    criado_em: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "area_id": self.area_id,
            "tipo": self.tipo,
            "identificador": self.identificador,
            "criado_em": self.criado_em,
        }


CAMPOS_EDITAVEIS = {
    "nome", "trello_key", "trello_token", "trello_secret", "board_id", "board_nome",
    "list_ideias", "list_ideias_nome", "list_tarefas", "list_tarefas_nome",
}


class AreaStore:
    """Persistência das áreas e dos vínculos, no mesmo SQLite da fila."""

    def __init__(self, caminho: Path | str, timezone: str = "America/Sao_Paulo") -> None:
        self._tz = ZoneInfo(timezone)
        self._lock = Lock()
        Path(str(caminho)).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(caminho), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        with self._lock:
            self._conn.executescript(ESQUEMA)
            self._conn.commit()

    def _agora(self) -> str:
        return datetime.now(self._tz).isoformat(timespec="seconds")

    # ---------------------------------------------------------------- áreas
    def criar(self, nome: str, **campos: str) -> Area:
        nome = " ".join((nome or "").split())
        if len(nome) < 2:
            raise AreaError("O nome da área precisa de pelo menos 2 caracteres.")
        desconhecidos = set(campos) - CAMPOS_EDITAVEIS
        if desconhecidos:
            raise AreaError(f"campos desconhecidos: {', '.join(sorted(desconhecidos))}")

        with self._lock:
            if self._conn.execute(
                "SELECT 1 FROM areas WHERE lower(nome) = lower(?)", (nome,)
            ).fetchone():
                raise AreaError(f"Já existe uma área chamada '{nome}'.")
            primeira = not self._conn.execute("SELECT 1 FROM areas LIMIT 1").fetchone()
            colunas = ["nome", "criada_em", "padrao"] + list(campos)
            valores = [nome, self._agora(), 1 if primeira else 0] + list(campos.values())
            marcadores = ", ".join("?" for _ in colunas)
            cursor = self._conn.execute(
                f"INSERT INTO areas ({', '.join(colunas)}) VALUES ({marcadores})", valores
            )
            self._conn.commit()
            area_id = int(cursor.lastrowid)
        return self.obter(area_id)

    def atualizar(self, area_id: int, **campos: str) -> Area:
        desconhecidos = set(campos) - CAMPOS_EDITAVEIS
        if desconhecidos:
            raise AreaError(f"campos desconhecidos: {', '.join(sorted(desconhecidos))}")
        if not campos:
            return self.obter(area_id)
        if "nome" in campos:
            campos["nome"] = " ".join(campos["nome"].split())
            with self._lock:
                conflito = self._conn.execute(
                    "SELECT 1 FROM areas WHERE lower(nome) = lower(?) AND id != ?",
                    (campos["nome"], area_id),
                ).fetchone()
            if conflito:
                raise AreaError(f"Já existe uma área chamada '{campos['nome']}'.")

        atribuicoes = ", ".join(f"{campo} = ?" for campo in campos)
        with self._lock:
            cursor = self._conn.execute(
                f"UPDATE areas SET {atribuicoes} WHERE id = ?",
                list(campos.values()) + [area_id],
            )
            self._conn.commit()
        if not cursor.rowcount:
            raise AreaError(f"área {area_id} não encontrada")
        return self.obter(area_id)

    def remover(self, area_id: int) -> None:
        area = self.obter(area_id)
        with self._lock:
            self._conn.execute("DELETE FROM vinculos WHERE area_id = ?", (area_id,))
            self._conn.execute("DELETE FROM areas WHERE id = ?", (area_id,))
            self._conn.commit()
            if area.padrao:
                # A área padrão sumiu: promove a mais antiga que sobrou.
                sobrou = self._conn.execute("SELECT id FROM areas ORDER BY id LIMIT 1").fetchone()
                if sobrou:
                    self._conn.execute("UPDATE areas SET padrao = 1 WHERE id = ?", (sobrou["id"],))
                    self._conn.commit()

    def definir_padrao(self, area_id: int) -> Area:
        self.obter(area_id)  # valida
        with self._lock:
            self._conn.execute("UPDATE areas SET padrao = 0")
            self._conn.execute("UPDATE areas SET padrao = 1 WHERE id = ?", (area_id,))
            self._conn.commit()
        return self.obter(area_id)

    def obter(self, area_id: int) -> Area:
        with self._lock:
            linha = self._conn.execute("SELECT * FROM areas WHERE id = ?", (area_id,)).fetchone()
        if not linha:
            raise AreaError(f"área {area_id} não encontrada")
        return _para_area(linha)

    def obter_por_nome(self, nome: str) -> Area | None:
        """Busca tolerante: ignora acento, caixa e espaços; aceita nome parcial."""
        alvo = normalizar(nome)
        if not alvo:
            return None
        candidatas = self.listar()
        for area in candidatas:
            if normalizar(area.nome) == alvo:
                return area
        parciais = [a for a in candidatas if alvo in normalizar(a.nome)]
        return parciais[0] if len(parciais) == 1 else None

    def listar(self) -> list[Area]:
        with self._lock:
            linhas = self._conn.execute(
                "SELECT * FROM areas ORDER BY padrao DESC, nome COLLATE NOCASE"
            ).fetchall()
        return [_para_area(linha) for linha in linhas]

    def padrao(self) -> Area | None:
        with self._lock:
            linha = self._conn.execute(
                "SELECT * FROM areas ORDER BY padrao DESC, id LIMIT 1"
            ).fetchone()
        return _para_area(linha) if linha else None

    # -------------------------------------------------------------- vínculos
    def vincular(self, area_id: int, identificador: str, tipo: str = "grupo") -> Vinculo:
        """Liga um grupo/contato a uma área. Reaponta se já existir em outra."""
        self.obter(area_id)
        identificador = " ".join((identificador or "").split())
        if len(identificador) < 2:
            raise AreaError("Informe o nome do grupo ou do contato.")
        if tipo not in ("grupo", "contato"):
            raise AreaError("tipo deve ser 'grupo' ou 'contato'")

        chave = f"{tipo}:{normalizar(identificador)}"
        with self._lock:
            self._conn.execute(
                """INSERT INTO vinculos (area_id, tipo, identificador, chave, criado_em)
                        VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT(chave) DO UPDATE SET
                        area_id = excluded.area_id,
                        identificador = excluded.identificador,
                        criado_em = excluded.criado_em""",
                (area_id, tipo, identificador, chave, self._agora()),
            )
            self._conn.commit()
            linha = self._conn.execute(
                "SELECT * FROM vinculos WHERE chave = ?", (chave,)
            ).fetchone()
        return _para_vinculo(linha)

    def desvincular(self, *, vinculo_id: int | None = None,
                    identificador: str | None = None, tipo: str = "grupo") -> bool:
        with self._lock:
            if vinculo_id is not None:
                cursor = self._conn.execute("DELETE FROM vinculos WHERE id = ?", (vinculo_id,))
            else:
                chave = f"{tipo}:{normalizar(identificador or '')}"
                cursor = self._conn.execute("DELETE FROM vinculos WHERE chave = ?", (chave,))
            self._conn.commit()
            return cursor.rowcount > 0

    def vinculos(self, area_id: int | None = None) -> list[Vinculo]:
        with self._lock:
            if area_id is None:
                linhas = self._conn.execute(
                    "SELECT * FROM vinculos ORDER BY area_id, identificador COLLATE NOCASE"
                ).fetchall()
            else:
                linhas = self._conn.execute(
                    "SELECT * FROM vinculos WHERE area_id = ? "
                    "ORDER BY identificador COLLATE NOCASE",
                    (area_id,),
                ).fetchall()
        return [_para_vinculo(linha) for linha in linhas]

    def area_de(self, identificador: str, tipo: str = "grupo") -> Area | None:
        chave = f"{tipo}:{normalizar(identificador or '')}"
        with self._lock:
            linha = self._conn.execute(
                "SELECT area_id FROM vinculos WHERE chave = ?", (chave,)
            ).fetchone()
        return self.obter(linha["area_id"]) if linha else None

    def resolver(self, *, grupo: str | None, autor: str | None = None,
                 usar_padrao: bool = True) -> Area | None:
        """Descobre a área de destino de uma mensagem.

        Ordem: vínculo do grupo → vínculo do contato → área padrão.
        """
        if grupo:
            achada = self.area_de(grupo, "grupo")
            if achada:
                return achada
        if autor:
            achada = self.area_de(autor, "contato")
            if achada:
                return achada
        return self.padrao() if usar_padrao else None

    # -------------------------------------------------------------- migração
    def migrar_do_env(self, settings: Any, nome: str = "EXPANSAO OSASCO") -> Area | None:
        """Na primeira execução, transforma a configuração do .env na área inicial.

        Mantém funcionando quem já usava a versão de área única.
        """
        if self.listar():
            return None
        if not (settings.trello_list_id_ideias and settings.trello_list_id_tarefas):
            return None
        area = self.criar(
            nome,
            list_ideias=settings.trello_list_id_ideias,
            list_tarefas=settings.trello_list_id_tarefas,
        )
        for grupo in getattr(settings, "whatsapp_grupos", ()) or ():
            self.vincular(area.id, grupo, "grupo")
        return area

    def close(self) -> None:
        with self._lock:
            self._conn.close()


def _para_area(linha: sqlite3.Row) -> Area:
    return Area(
        id=linha["id"],
        nome=linha["nome"],
        trello_key=linha["trello_key"],
        trello_token=linha["trello_token"],
        trello_secret=linha["trello_secret"],
        board_id=linha["board_id"],
        board_nome=linha["board_nome"],
        list_ideias=linha["list_ideias"],
        list_ideias_nome=linha["list_ideias_nome"],
        list_tarefas=linha["list_tarefas"],
        list_tarefas_nome=linha["list_tarefas_nome"],
        padrao=bool(linha["padrao"]),
        criada_em=linha["criada_em"],
    )


def _para_vinculo(linha: sqlite3.Row) -> Vinculo:
    return Vinculo(
        id=linha["id"],
        area_id=linha["area_id"],
        tipo=linha["tipo"],
        identificador=linha["identificador"],
        criado_em=linha["criado_em"],
    )
