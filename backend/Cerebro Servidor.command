#!/bin/bash
# Cérebro de Operações — MODO SERVIDOR.
# Sobe na rede local (0.0.0.0) para o WhatsApp e os outros aparelhos da equipe
# alcançarem, e mostra o endereço e o token de acesso.

set -uo pipefail
cd "$(dirname "$0")" || exit 1

VERDE=$'\033[32m'; AZUL=$'\033[36m'; AMARELO=$'\033[33m'; VERMELHO=$'\033[31m'; FIM=$'\033[0m'
VENV="venv"
PY="$VENV/bin/python"
MARCADOR="$VENV/.dependencias-ok"

falhar() {
  echo "${VERMELHO}✕ $1${FIM}"
  /usr/bin/osascript -e "display alert \"Cérebro de Operações\" message \"$1\" as critical" >/dev/null 2>&1
  echo; read -r -p "Pressione Enter para fechar…" _; exit 1
}

echo "${AZUL}────────────────────────────────────────────────────────${FIM}"
echo "  🧠 ${AZUL}CÉREBRO DE OPERAÇÕES${FIM} · modo servidor"
echo "${AZUL}────────────────────────────────────────────────────────${FIM}"

PYTHON_BASE="$(command -v python3 || true)"
[ -n "$PYTHON_BASE" ] || falhar "Python 3 não encontrado. Instale com: xcode-select --install"

venv_utilizavel() {
  [ -x "$PY" ] && "$PY" -c "import sys" >/dev/null 2>&1
}

if ! venv_utilizavel; then
  if [ -e "$VENV" ]; then
    echo "→ Ambiente virtual incompleto — refazendo do zero…"
    rm -rf "$VENV"
  else
    echo "→ Criando ambiente virtual…"
  fi
  "$PYTHON_BASE" -m venv "$VENV" || falhar "Não consegui criar o ambiente virtual."
  rm -f "$MARCADOR"
fi
if [ ! -f "$MARCADOR" ] || [ requirements.txt -nt "$MARCADOR" ]; then
  echo "→ Instalando dependências…"
  "$PY" -m pip install --quiet --upgrade pip \
    && "$PY" -m pip install --quiet -r requirements.txt \
    || falhar "Falha ao instalar as dependências."
  touch "$MARCADOR"
fi

[ -f .env ] || { cp .env.example .env; open -e .env 2>/dev/null; \
  falhar "Criei o .env — preencha as chaves e rode de novo."; }

# Gera um token na primeira vez: servidor exposto sem senha não é opção.
TOKEN="$("$PY" - <<'PY'
import secrets
from dotenv import dotenv_values
from pathlib import Path
import sys
sys.path.insert(0, ".")
from cerebro.config import write_env_values

valores = dotenv_values(".env")
token = (valores.get("SERVER_TOKEN") or "").strip()
if not token:
    token = secrets.token_urlsafe(12)
    write_env_values({"SERVER_TOKEN": token, "HOST": "0.0.0.0"}, env_path=Path(".env"))
elif (valores.get("HOST") or "").strip() != "0.0.0.0":
    write_env_values({"HOST": "0.0.0.0"}, env_path=Path(".env"))
print(token)
PY
)"
[ -n "$TOKEN" ] || falhar "Não consegui preparar o token de acesso."

PORTA="$(grep -E '^PORT=' .env | cut -d= -f2 | tr -d ' ')"
PORTA="${PORTA:-8000}"
IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo 127.0.0.1)"

echo
echo "${VERDE}✓${FIM} Servidor: ${AZUL}http://$IP:$PORTA/${FIM}"
echo "${VERDE}✓${FIM} Token da equipe: ${AMARELO}$TOKEN${FIM}"
echo
echo "  Painel em outro aparelho da mesma rede:"
echo "    ${AZUL}http://$IP:$PORTA/?token=$TOKEN${FIM}"
echo
echo "  Webhook do WhatsApp (rede local):"
echo "    ${AZUL}http://$IP:$PORTA/webhook/whatsapp${FIM}"
echo
echo "  Para receber de fora da rede, abra um túnel em outra aba:"
echo "    ${AMARELO}cloudflared tunnel --url http://127.0.0.1:$PORTA${FIM}"
echo "  e use a URL https gerada + /webhook/whatsapp no provedor."
echo
echo "${AZUL}Para parar:${FIM} Ctrl+C"
echo

exec "$PY" -m uvicorn main:app --host 0.0.0.0 --port "$PORTA" --log-level warning
