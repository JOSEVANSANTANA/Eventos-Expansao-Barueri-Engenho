#!/bin/bash
# Cria a instância na Evolution API, aponta o webhook para o Cérebro e abre o
# QR code para você parear o número do WhatsApp.
#
#   bash conectar.sh           cria/atualiza a instância e mostra o QR
#   bash conectar.sh status    mostra o estado da conexão
#   bash conectar.sh grupos    lista os grupos do número conectado

set -uo pipefail
cd "$(dirname "$0")" || exit 1

VERDE=$'\033[32m'; AZUL=$'\033[36m'; AMARELO=$'\033[33m'; VERMELHO=$'\033[31m'; FIM=$'\033[0m'

[ -f .env ] || { echo "${VERMELHO}✕${FIM} Crie o .env:  cp .env.exemplo .env"; exit 1; }
set -a; . ./.env; set +a

CHAVE="${EVOLUTION_API_KEY:-}"
INSTANCIA="${INSTANCIA:-cerebro}"
CEREBRO_PORTA="${CEREBRO_PORTA:-8000}"
BASE="http://localhost:8080"
WEBHOOK="http://host.docker.internal:${CEREBRO_PORTA}/webhook/whatsapp"

[ -n "$CHAVE" ] || { echo "${VERMELHO}✕${FIM} Defina EVOLUTION_API_KEY no .env"; exit 1; }

api() {  # api MÉTODO CAMINHO [JSON]
  local metodo="$1" caminho="$2" corpo="${3:-}"
  if [ -n "$corpo" ]; then
    curl -sS -X "$metodo" "$BASE$caminho" -H "apikey: $CHAVE" \
      -H "Content-Type: application/json" -d "$corpo"
  else
    curl -sS -X "$metodo" "$BASE$caminho" -H "apikey: $CHAVE"
  fi
}

esperar_evolution() {
  for _ in $(seq 1 30); do
    curl -sf --max-time 2 "$BASE" >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

case "${1:-conectar}" in
  status)
    echo "${AZUL}Estado da instância '$INSTANCIA':${FIM}"
    api GET "/instance/connectionState/$INSTANCIA" | python3 -m json.tool 2>/dev/null \
      || echo "(sem resposta — a Evolution API está rodando? docker compose ps)"
    exit 0
    ;;
  grupos)
    echo "${AZUL}Grupos do número conectado:${FIM}"
    api GET "/group/fetchAllGroups/$INSTANCIA?getParticipants=false" \
      | python3 -c '
import json, sys
try:
    dados = json.load(sys.stdin)
except Exception:
    print("(resposta inesperada — confira o status da conexão)"); raise SystemExit
grupos = dados if isinstance(dados, list) else dados.get("groups", [])
for grupo in grupos:
    print(f"  • {grupo.get(\"subject\", \"sem nome\")}   {grupo.get(\"id\", \"\")}")
print("\nCopie o nome do grupo para WHATSAPP_GRUPOS no backend/.env")'
    exit 0
    ;;
esac

echo "${AZUL}→ Aguardando a Evolution API subir…${FIM}"
esperar_evolution || {
  echo "${VERMELHO}✕${FIM} Evolution API não respondeu em http://localhost:8080"
  echo "  Suba com: docker compose up -d   (e confira: docker compose logs -f evolution)"
  exit 1
}

echo "${AZUL}→ Criando a instância '$INSTANCIA' com webhook para o Cérebro…${FIM}"
RESPOSTA="$(api POST /instance/create "$(cat <<JSON
{
  "instanceName": "$INSTANCIA",
  "integration": "WHATSAPP-BAILEYS",
  "qrcode": true,
  "webhook": {
    "url": "$WEBHOOK",
    "byEvents": false,
    "base64": false,
    "events": ["MESSAGES_UPSERT"]
  }
}
JSON
)")"

# Instância já existente: só reaponta o webhook e pede um QR novo.
if echo "$RESPOSTA" | grep -qi "already in use\|already exists"; then
  echo "${AMARELO}!${FIM} Instância já existe — atualizando o webhook."
  api POST "/webhook/set/$INSTANCIA" "$(cat <<JSON
{"webhook": {"enabled": true, "url": "$WEBHOOK", "byEvents": false,
 "events": ["MESSAGES_UPSERT"]}}
JSON
)" >/dev/null
  RESPOSTA="$(api GET "/instance/connect/$INSTANCIA")"
fi

echo "$RESPOSTA" > /tmp/cerebro-evolution.json

QR="$(python3 - <<'PY'
import base64, json, pathlib, re
try:
    dados = json.loads(pathlib.Path("/tmp/cerebro-evolution.json").read_text())
except Exception:
    raise SystemExit
def achar(obj, chave):
    if isinstance(obj, dict):
        if chave in obj and isinstance(obj[chave], str):
            return obj[chave]
        for valor in obj.values():
            achado = achar(valor, chave)
            if achado:
                return achado
    return None
b64 = achar(dados, "base64")
if b64:
    conteudo = re.sub(r"^data:image/\w+;base64,", "", b64)
    destino = pathlib.Path("/tmp/cerebro-qrcode.png")
    destino.write_bytes(base64.b64decode(conteudo))
    print(destino)
PY
)"

if [ -n "$QR" ]; then
  echo "${VERDE}✓${FIM} QR code gerado. Abrindo…"
  open "$QR" 2>/dev/null
  echo
  echo "  No celular: WhatsApp → Configurações → ${AZUL}Aparelhos conectados${FIM}"
  echo "  → Conectar aparelho → aponte para o QR."
  echo
  echo "  Depois de parear, rode: ${AMARELO}bash conectar.sh grupos${FIM}"
  echo "  para pegar o nome exato do grupo e colocar em WHATSAPP_GRUPOS."
else
  echo "${AMARELO}!${FIM} Não achei o QR na resposta. Conteúdo devolvido:"
  python3 -m json.tool < /tmp/cerebro-evolution.json 2>/dev/null || cat /tmp/cerebro-evolution.json
  echo
  echo "  Você também pode parear pelo painel da Evolution: $BASE/manager"
fi

echo
echo "${AZUL}No backend/.env do Cérebro:${FIM}"
echo "  WHATSAPP_PROVIDER=evolution"
echo "  WHATSAPP_API_KEY=$CHAVE"
