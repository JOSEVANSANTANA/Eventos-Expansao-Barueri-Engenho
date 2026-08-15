#!/usr/bin/env python3
"""Gera o ícone do app (PNG) usando só a biblioteca padrão.

Desenha um quadrado arredondado com gradiente e uma malha de nós — a marca do
Cérebro. Sem Pillow, sem download: roda em qualquer Mac com Python 3.

    python3 tools/criar_icone.py 1024 icone.png
"""

from __future__ import annotations

import math
import struct
import sys
import zlib

# Paleta alinhada ao painel web.
COR_INICIO = (79, 140, 255)   # --acento
COR_FIM = (176, 124, 255)     # --ideia
FUNDO = (15, 17, 21)          # --fundo

NOS = [
    (0.30, 0.27), (0.53, 0.19), (0.73, 0.31),
    (0.23, 0.51), (0.49, 0.45), (0.77, 0.54),
    (0.34, 0.74), (0.61, 0.77),
]
ARESTAS = [
    (0, 1), (1, 2), (0, 3), (0, 4), (1, 4), (2, 4), (2, 5),
    (3, 4), (4, 5), (3, 6), (4, 6), (4, 7), (5, 7), (6, 7),
]


def _suavizar(borda: float, distancia: float) -> float:
    """Cobertura antisserrilhada: 1 dentro, 0 fora, transição de ~1,5 px."""
    return min(1.0, max(0.0, 0.5 - distancia / max(borda, 1e-6)))


def _dist_retangulo_arredondado(x: float, y: float, meio: float, raio: float) -> float:
    dx = abs(x) - (meio - raio)
    dy = abs(y) - (meio - raio)
    fora = math.hypot(max(dx, 0.0), max(dy, 0.0))
    dentro = min(max(dx, dy), 0.0)
    return fora + dentro - raio


def _dist_segmento(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    comprimento = vx * vx + vy * vy
    t = 0.0 if comprimento == 0 else max(0.0, min(1.0, (wx * vx + wy * vy) / comprimento))
    return math.hypot(px - (ax + t * vx), py - (ay + t * vy))


def _mistura(base: tuple[float, float, float], cor, alfa: float):
    return tuple(base[i] * (1 - alfa) + cor[i] * alfa for i in range(3))


def desenhar(tamanho: int) -> bytes:
    """Devolve os bytes RGBA da imagem, linha a linha."""
    s = float(tamanho)
    meio = s / 2
    raio = s * 0.225
    raio_no = s * 0.043
    largura_aresta = s * 0.016
    aa = s / 512 + 0.9  # espessura da transição, proporcional ao tamanho

    nos = [(x * s, y * s) for x, y in NOS]
    linhas = bytearray()

    for py in range(tamanho):
        linhas.append(0)  # filtro PNG "None"
        y = py + 0.5
        for px in range(tamanho):
            x = px + 0.5

            cobertura = _suavizar(aa, _dist_retangulo_arredondado(x - meio, y - meio, meio, raio))
            if cobertura <= 0.0:
                linhas.extend((0, 0, 0, 0))
                continue

            # Gradiente diagonal do azul ao roxo.
            t = max(0.0, min(1.0, (x + y) / (2 * s)))
            cor = [COR_INICIO[i] + (COR_FIM[i] - COR_INICIO[i]) * t for i in range(3)]
            # Escurece as bordas para dar profundidade.
            vinheta = 1.0 - 0.18 * ((x - meio) ** 2 + (y - meio) ** 2) / (meio * meio)
            cor = [c * vinheta for c in cor]

            # Arestas da malha, em branco translúcido.
            melhor = min(
                _dist_segmento(x, y, nos[a][0], nos[a][1], nos[b][0], nos[b][1])
                for a, b in ARESTAS
            )
            alfa_aresta = _suavizar(aa, melhor - largura_aresta / 2) * 0.75
            if alfa_aresta > 0:
                cor = _mistura(cor, (255, 255, 255), alfa_aresta)

            # Nós.
            melhor_no = min(math.hypot(x - nx, y - ny) for nx, ny in nos)
            alfa_no = _suavizar(aa, melhor_no - raio_no)
            if alfa_no > 0:
                cor = _mistura(cor, (255, 255, 255), alfa_no)
                miolo = _suavizar(aa, melhor_no - raio_no * 0.45)
                if miolo > 0:
                    cor = _mistura(cor, FUNDO, miolo * 0.85)

            linhas.extend(
                (
                    int(max(0, min(255, cor[0]))),
                    int(max(0, min(255, cor[1]))),
                    int(max(0, min(255, cor[2]))),
                    int(cobertura * 255),
                )
            )
    return bytes(linhas)


def escrever_png(caminho: str, tamanho: int) -> None:
    def bloco(tipo: bytes, dados: bytes) -> bytes:
        conteudo = tipo + dados
        return (
            struct.pack(">I", len(dados))
            + conteudo
            + struct.pack(">I", zlib.crc32(conteudo) & 0xFFFFFFFF)
        )

    cabecalho = struct.pack(">IIBBBBB", tamanho, tamanho, 8, 6, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + bloco(b"IHDR", cabecalho)
        + bloco(b"IDAT", zlib.compress(desenhar(tamanho), 9))
        + bloco(b"IEND", b"")
    )
    with open(caminho, "wb") as arquivo:
        arquivo.write(png)


if __name__ == "__main__":
    tamanho = int(sys.argv[1]) if len(sys.argv) > 1 else 1024
    destino = sys.argv[2] if len(sys.argv) > 2 else "icone.png"
    escrever_png(destino, tamanho)
    print(f"{destino} ({tamanho}×{tamanho})")
