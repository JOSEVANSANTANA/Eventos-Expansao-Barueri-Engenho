"""Fila persistente em SQLite — o que faz o Cérebro sobreviver a queda de internet.

Toda mensagem que entra é gravada ANTES de qualquer chamada externa. Se o Gemini
ou o Trello estiverem fora do ar (ou o Mac estiver sem rede), a mensagem fica
pendente com uma próxima tentativa agendada e é reprocessada sozinha depois.
Nada se perde entre reinícios do app.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from threading import Lock
from typing import Any
from zoneinfo import ZoneInfo

ESQUEMA = """
CREATE TABLE IF NOT EXISTS mensagens (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id      TEXT UNIQUE,
    texto            TEXT NOT NULL,
    autor            TEXT,
    grupo            TEXT,
    origem           TEXT NOT NULL DEFAULT 'painel',
    recebida_em      TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'pendente',
    tentativas       INTEGER NOT NULL DEFAULT 0,
    proxima_tentativa TEXT,
    stage            TEXT,
    ultimo_erro      TEXT,
    action_type      TEXT,
    titulo           TEXT,
    card_id          TEXT,
    card_url         TEXT,
    due_date         TEXT,
    processada_em    TEXT
);
CREATE INDEX IF NOT EXISTS idx_mensagens_status ON mensagens(status, proxima_tentativa);
CREATE INDEX IF NOT EXISTS idx_mensagens_recebida ON mensagens(recebida_em DESC);
"""

# Backoff: 1min, 2min, 4min… até o teto de 1 hora.
BACKOFF_BASE_SEGUNDOS = 60
BACKOFF_TETO_SEGUNDOS = 3600
MAX_TENTATIVAS = 8


class Store:
    def __init__(self, caminho: Path | str, timezone: str = "America/Sao_Paulo") -> None:
        self._caminho = str(caminho)
        self._tz = ZoneInfo(timezone)
        self._lock = Lock()
        Path(self._caminho).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self._caminho, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        with self._lock:
            self._conn.executescript(ESQUEMA)
            self._conn.commit()

    # ------------------------------------------------------------------ tempo
    def _agora(self) -> datetime:
        return datetime.now(self._tz)

    def _iso(self, momento: datetime | None = None) -> str:
        return (momento or self._agora()).isoformat(timespec="seconds")

    # --------------------------------------------------------------- escrita
    def registrar(
        self,
        texto: str,
        *,
        autor: str | None = None,
        grupo: str | None = None,
        origem: str = "painel",
        external_id: str | None = None,
    ) -> int | None:
        """Grava a mensagem como pendente. Devolve None se já existia (duplicata)."""
        with self._lock:
            if external_id:
                achado = self._conn.execute(
                    "SELECT id FROM mensagens WHERE external_id = ?", (external_id,)
                ).fetchone()
                if achado:
                    return None
            cursor = self._conn.execute(
                """INSERT INTO mensagens (external_id, texto, autor, grupo, origem,
                                          recebida_em, status, proxima_tentativa)
                   VALUES (?, ?, ?, ?, ?, ?, 'pendente', ?)""",
                (external_id, texto, autor, grupo, origem, self._iso(), self._iso()),
            )
            self._conn.commit()
            return int(cursor.lastrowid)

    def marcar_sucesso(self, mensagem_id: int, resposta: Any) -> None:
        status = "criado" if resposta.status == "created" else "ignorado"
        with self._lock:
            self._conn.execute(
                """UPDATE mensagens
                      SET status = ?, action_type = ?, titulo = ?, card_id = ?,
                          card_url = ?, due_date = ?, processada_em = ?,
                          stage = NULL, ultimo_erro = NULL, proxima_tentativa = NULL
                    WHERE id = ?""",
                (
                    status,
                    resposta.action_type.value,
                    resposta.title,
                    resposta.card_id,
                    resposta.card_url,
                    resposta.due_date,
                    self._iso(),
                    mensagem_id,
                ),
            )
            self._conn.commit()

    def marcar_falha(
        self, mensagem_id: int, stage: str, erro: str, *, reagendar: bool = True
    ) -> None:
        """Registra a falha. `reagendar=False` para erros que repetir não resolve."""
        with self._lock:
            linha = self._conn.execute(
                "SELECT tentativas FROM mensagens WHERE id = ?", (mensagem_id,)
            ).fetchone()
            tentativas = (linha["tentativas"] if linha else 0) + 1

            if reagendar and tentativas < MAX_TENTATIVAS:
                espera = min(
                    BACKOFF_BASE_SEGUNDOS * (2 ** (tentativas - 1)), BACKOFF_TETO_SEGUNDOS
                )
                status = "pendente"
                proxima = self._iso(self._agora() + timedelta(seconds=espera))
            else:
                status = "erro"
                proxima = None

            self._conn.execute(
                """UPDATE mensagens
                      SET status = ?, tentativas = ?, stage = ?, ultimo_erro = ?,
                          proxima_tentativa = ?
                    WHERE id = ?""",
                (status, tentativas, stage, erro[:500], proxima, mensagem_id),
            )
            self._conn.commit()

    # --------------------------------------------------------------- leitura
    def pendentes_vencidas(self, limite: int = 10) -> list[dict[str, Any]]:
        """Mensagens pendentes cuja hora de nova tentativa já chegou."""
        with self._lock:
            linhas = self._conn.execute(
                """SELECT * FROM mensagens
                    WHERE status = 'pendente'
                      AND (proxima_tentativa IS NULL OR proxima_tentativa <= ?)
                 ORDER BY id ASC LIMIT ?""",
                (self._iso(), limite),
            ).fetchall()
        return [dict(linha) for linha in linhas]

    def historico(self, limite: int = 60) -> list[dict[str, Any]]:
        with self._lock:
            linhas = self._conn.execute(
                "SELECT * FROM mensagens ORDER BY id DESC LIMIT ?", (limite,)
            ).fetchall()
        return [dict(linha) for linha in linhas]

    def estatisticas(self) -> dict[str, int]:
        with self._lock:
            linhas = self._conn.execute(
                "SELECT status, COUNT(*) AS total FROM mensagens GROUP BY status"
            ).fetchall()
        contagem = {linha["status"]: linha["total"] for linha in linhas}
        return {
            "pendentes": contagem.get("pendente", 0),
            "criados": contagem.get("criado", 0),
            "ignorados": contagem.get("ignorado", 0),
            "erros": contagem.get("erro", 0),
            "total": sum(contagem.values()),
        }

    def limpar(self, *, apenas_concluidas: bool = True) -> int:
        """Limpa o histórico. Por padrão preserva o que ainda está na fila."""
        with self._lock:
            if apenas_concluidas:
                cursor = self._conn.execute(
                    "DELETE FROM mensagens WHERE status IN ('criado','ignorado','erro')"
                )
            else:
                cursor = self._conn.execute("DELETE FROM mensagens")
            self._conn.commit()
            return cursor.rowcount

    def reenfileirar_erros(self) -> int:
        """Devolve para a fila tudo que desistiu — usado pelo botão do painel."""
        with self._lock:
            cursor = self._conn.execute(
                """UPDATE mensagens
                      SET status = 'pendente', tentativas = 0, proxima_tentativa = ?
                    WHERE status = 'erro'""",
                (self._iso(),),
            )
            self._conn.commit()
            return cursor.rowcount

    def close(self) -> None:
        with self._lock:
            self._conn.close()
