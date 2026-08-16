#!/bin/bash
# Deixa o Cérebro rodando SEMPRE: inicia junto com o login do Mac e reinicia
# sozinho se cair. Use quando o WhatsApp estiver conectado e as mensagens
# precisarem ser capturadas mesmo com o painel fechado.
#
#   bash instalar_servico.sh            instala e inicia
#   bash instalar_servico.sh remover    desinstala

set -uo pipefail
cd "$(dirname "$0")" || exit 1

BACKEND="$(pwd -P)"
ROTULO="br.com.expansaoosasco.cerebro"
PLIST="$HOME/Library/LaunchAgents/$ROTULO.plist"
LOGS="$HOME/Library/Logs"
VERDE=$'\033[32m'; AZUL=$'\033[36m'; AMARELO=$'\033[33m'; FIM=$'\033[0m'

if [ "${1:-}" = "remover" ]; then
  launchctl unload "$PLIST" 2>/dev/null
  rm -f "$PLIST"
  echo "${VERDE}✓${FIM} Serviço removido. O Cérebro não sobe mais sozinho."
  exit 0
fi

PY="$BACKEND/venv/bin/python"
if ! { [ -x "$PY" ] && "$PY" -c "import sys" >/dev/null 2>&1; }; then
  [ -e "$BACKEND/venv" ] && { echo "→ Ambiente virtual incompleto — refazendo…"; rm -rf "$BACKEND/venv"; }
  echo "→ Criando ambiente virtual…"
  python3 -m venv "$BACKEND/venv" || exit 1
  "$PY" -m pip install --quiet --upgrade pip
  "$PY" -m pip install --quiet -r "$BACKEND/requirements.txt" || exit 1
fi

[ -f "$BACKEND/.env" ] || cp "$BACKEND/.env.example" "$BACKEND/.env"
PORTA="$(grep -E '^PORT=' "$BACKEND/.env" | cut -d= -f2 | tr -d ' ')"
PORTA="${PORTA:-8000}"
HOSTE="$(grep -E '^HOST=' "$BACKEND/.env" | cut -d= -f2 | tr -d ' ')"
HOSTE="${HOSTE:-127.0.0.1}"

mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$ROTULO</string>
  <key>ProgramArguments</key>
  <array>
    <string>$PY</string>
    <string>-m</string>
    <string>uvicorn</string>
    <string>main:app</string>
    <string>--host</string><string>$HOSTE</string>
    <string>--port</string><string>$PORTA</string>
    <string>--log-level</string><string>warning</string>
  </array>
  <key>WorkingDirectory</key><string>$BACKEND</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOGS/CerebroOperacoes.log</string>
  <key>StandardErrorPath</key><string>$LOGS/CerebroOperacoes.log</string>
</dict>
</plist>
PLISTEOF

launchctl unload "$PLIST" 2>/dev/null
launchctl load "$PLIST" || { echo "Falha ao carregar o serviço."; exit 1; }

echo "${VERDE}✓${FIM} Cérebro instalado como serviço."
echo "   Painel:  ${AZUL}http://127.0.0.1:$PORTA/${FIM}"
echo "   Log:     $LOGS/CerebroOperacoes.log"
echo "   Parar:   ${AMARELO}bash instalar_servico.sh remover${FIM}"
echo
echo "O Mac precisa estar ligado e logado para o serviço rodar."
