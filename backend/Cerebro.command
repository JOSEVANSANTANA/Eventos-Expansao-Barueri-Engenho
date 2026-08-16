#!/bin/bash
# Cérebro de Operações — duplo clique no Finder para ligar tudo.
# Prepara o ambiente, sobe o servidor local e abre o painel no Google Chrome.

set -uo pipefail
cd "$(dirname "$0")" || exit 1

VERDE=$'\033[32m'; AZUL=$'\033[36m'; AMARELO=$'\033[33m'; VERMELHO=$'\033[31m'; FIM=$'\033[0m'
VENV="venv"
PY="$VENV/bin/python"
MARCADOR="$VENV/.dependencias-ok"

aviso_grafico() {  # mostra erro também em janela, caso tenha sido aberto pelo app
  /usr/bin/osascript -e "display alert \"Cérebro de Operações\" message \"$1\" as critical" >/dev/null 2>&1
}

falhar() {
  echo "${VERMELHO}✕ $1${FIM}"
  aviso_grafico "$1"
  echo
  read -r -p "Pressione Enter para fechar…" _
  exit 1
}

echo "${AZUL}────────────────────────────────────────────────────────${FIM}"
echo "  🧠 ${AZUL}CÉREBRO DE OPERAÇÕES${FIM} · EXPANSAO OSASCO"
echo "${AZUL}────────────────────────────────────────────────────────${FIM}"

# 1 · Python -----------------------------------------------------------------
PYTHON_BASE="$(command -v python3 || true)"
[ -n "$PYTHON_BASE" ] || falhar "Python 3 não encontrado. Instale com: xcode-select --install"

if ! "$PYTHON_BASE" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)'; then
  falhar "Python 3.10 ou mais novo é necessário (encontrado: $("$PYTHON_BASE" -V 2>&1))."
fi

# 2 · Ambiente virtual --------------------------------------------------------
# A pasta pode existir de uma tentativa interrompida: aí o `venv` falha com
# "File exists". Só confiamos nela se o python de dentro realmente funcionar.
venv_utilizavel() {
  [ -x "$PY" ] && "$PY" -c "import sys" >/dev/null 2>&1
}

if ! venv_utilizavel; then
  if [ -e "$VENV" ]; then
    echo "→ Ambiente virtual incompleto — refazendo do zero…"
    rm -rf "$VENV"
  else
    echo "→ Criando ambiente virtual (só na primeira vez)…"
  fi
  "$PYTHON_BASE" -m venv "$VENV" || falhar "Não consegui criar o ambiente virtual em $(pwd)/$VENV"
  rm -f "$MARCADOR"
fi

if [ ! -f "$MARCADOR" ] || [ requirements.txt -nt "$MARCADOR" ]; then
  echo "→ Instalando dependências (pode demorar um pouco na primeira vez)…"
  "$PY" -m pip install --quiet --upgrade pip \
    && "$PY" -m pip install --quiet -r requirements.txt \
    || falhar "Falha ao instalar as dependências. Verifique sua conexão."
  touch "$MARCADOR"
fi
echo "${VERDE}✓${FIM} Ambiente pronto."

# 3 · Configuração ------------------------------------------------------------
if [ ! -f .env ]; then
  cp .env.example .env
  echo "${AMARELO}!${FIM} Criei o arquivo .env a partir do exemplo."
  echo "  Preencha GEMINI_API_KEY, TRELLO_API_KEY e TRELLO_TOKEN e rode de novo."
  open -e .env 2>/dev/null
  read -r -p "Pressione Enter depois de salvar o .env para continuar…" _
fi

# 4 · Porta livre -------------------------------------------------------------
PORTA="$("$PY" - <<'PY'
import os, socket
try:
    from dotenv import dotenv_values
    inicio = int(dotenv_values(".env").get("PORT") or 8000)
except Exception:
    inicio = 8000
for porta in range(inicio, inicio + 40):
    with socket.socket() as s:
        try:
            s.bind(("127.0.0.1", porta))
        except OSError:
            continue
        print(porta)
        break
PY
)"
[ -n "$PORTA" ] || falhar "Nenhuma porta livre entre 8000 e 8040."
URL="http://127.0.0.1:$PORTA/"

# 5 · Servidor ----------------------------------------------------------------
echo "→ Subindo o servidor em $URL"
HOST=127.0.0.1 PORT="$PORTA" \
  "$PY" -m uvicorn main:app --host 127.0.0.1 --port "$PORTA" --log-level warning &
SERVIDOR=$!

encerrar() {
  echo
  echo "→ Encerrando o Cérebro…"
  kill "$SERVIDOR" 2>/dev/null
  wait "$SERVIDOR" 2>/dev/null
}
trap encerrar EXIT INT TERM

for _ in $(seq 1 40); do
  if curl -sf --max-time 2 "${URL}health" >/dev/null 2>&1; then PRONTO=1; break; fi
  kill -0 "$SERVIDOR" 2>/dev/null || break
  sleep 0.5
done

if [ "${PRONTO:-0}" != "1" ]; then
  falhar "O servidor não respondeu. Veja as mensagens acima para o motivo."
fi
echo "${VERDE}✓${FIM} Servidor no ar."

# 6 · Chrome ------------------------------------------------------------------
if open -a "Google Chrome" "$URL" 2>/dev/null; then
  echo "${VERDE}✓${FIM} Painel aberto no Google Chrome."
else
  echo "${AMARELO}!${FIM} Google Chrome não encontrado — abrindo no navegador padrão."
  open "$URL"
fi

echo
echo "${AZUL}Painel:${FIM} $URL"
echo "${AZUL}Para parar:${FIM} botão 'Encerrar' no painel, ou Ctrl+C aqui."
echo

wait "$SERVIDOR"
