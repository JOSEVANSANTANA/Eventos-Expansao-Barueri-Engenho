"""Saída de terminal enxuta e colorida para acompanhar o processamento em tempo real.

Usa apenas ANSI puro (sem dependências extras) e desliga as cores automaticamente
quando a saída não é um TTY — logs redirecionados para arquivo continuam legíveis.
"""

from __future__ import annotations

import logging
import os
import sys

LOGGER_NAME = "cerebro"


def _colors_enabled() -> bool:
    if os.getenv("NO_COLOR"):
        return False
    return sys.stdout.isatty()


_ENABLED = _colors_enabled()


def _paint(code: str, text: str) -> str:
    return f"\033[{code}m{text}\033[0m" if _ENABLED else text


def dim(text: str) -> str:
    return _paint("2", text)


def bold(text: str) -> str:
    return _paint("1", text)


def cyan(text: str) -> str:
    return _paint("36", text)


def green(text: str) -> str:
    return _paint("32", text)


def yellow(text: str) -> str:
    return _paint("33", text)


def red(text: str) -> str:
    return _paint("31", text)


class CerebroFormatter(logging.Formatter):
    """Formata cada linha como `HH:MM:SS  ICONE  mensagem`."""

    ICONS = {
        logging.DEBUG: dim("·"),
        logging.INFO: cyan("›"),
        logging.WARNING: yellow("!"),
        logging.ERROR: red("✕"),
        logging.CRITICAL: red("✕"),
    }

    def format(self, record: logging.LogRecord) -> str:
        icon = self.ICONS.get(record.levelno, cyan("›"))
        stamp = dim(self.formatTime(record, "%H:%M:%S"))
        message = record.getMessage()
        if record.exc_info:
            message = f"{message}\n{self.formatException(record.exc_info)}"
        return f"{stamp}  {icon}  {message}"


def get_logger() -> logging.Logger:
    """Logger único da aplicação, configurado uma só vez."""
    logger = logging.getLogger(LOGGER_NAME)
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(CerebroFormatter())
        logger.addHandler(handler)
        logger.setLevel(os.getenv("LOG_LEVEL", "INFO").upper())
        logger.propagate = False
    return logger


log = get_logger()


def banner(host: str, port: int, model: str) -> None:
    """Cabeçalho de boot — o primeiro sinal de vida no terminal."""
    line = "─" * 58
    print(dim(line))
    print(f"  {bold('CÉREBRO DE OPERAÇÕES')}  {dim('· EXPANSAO OSASCO')}")
    print(f"  {dim('modelo')}   {model}")
    print(f"  {dim('webhook')}  http://{host}:{port}/webhook")
    print(f"  {dim('saúde')}    http://{host}:{port}/health")
    print(dim(line))
