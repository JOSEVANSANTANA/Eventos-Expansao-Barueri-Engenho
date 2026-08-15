#!/bin/bash
# Cria o app "Cérebro de Operações.app" em ~/Applications, com ícone próprio.
# Rode uma única vez:  bash instalar_app.sh

set -uo pipefail
cd "$(dirname "$0")" || exit 1

BACKEND="$(pwd -P)"
NOME="Cérebro de Operações"
DESTINO="$HOME/Applications/$NOME.app"
VERDE=$'\033[32m'; AZUL=$'\033[36m'; AMARELO=$'\033[33m'; FIM=$'\033[0m'

echo "${AZUL}Instalando “$NOME”…${FIM}"
mkdir -p "$HOME/Applications"
rm -rf "$DESTINO"
mkdir -p "$DESTINO/Contents/MacOS" "$DESTINO/Contents/Resources"

# --- executável --------------------------------------------------------------
cat > "$DESTINO/Contents/MacOS/Cerebro" <<LAUNCHER
#!/bin/bash
# Abre o Terminal rodando o Cerebro.command do projeto.
BACKEND="$BACKEND"
if [ ! -x "\$BACKEND/Cerebro.command" ]; then
  /usr/bin/osascript -e 'display alert "Cérebro de Operações" message "A pasta do projeto foi movida. Rode instalar_app.sh de novo no novo local." as critical'
  exit 1
fi
open -a Terminal "\$BACKEND/Cerebro.command"
LAUNCHER
chmod +x "$DESTINO/Contents/MacOS/Cerebro"
chmod +x "$BACKEND/Cerebro.command"

# --- Info.plist --------------------------------------------------------------
cat > "$DESTINO/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Cérebro de Operações</string>
  <key>CFBundleDisplayName</key><string>Cérebro de Operações</string>
  <key>CFBundleIdentifier</key><string>br.com.expansaoosasco.cerebro</string>
  <key>CFBundleVersion</key><string>1.0.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleExecutable</key><string>Cerebro</string>
  <key>CFBundleIconFile</key><string>cerebro</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

# --- ícone -------------------------------------------------------------------
PY="venv/bin/python"
[ -x "$PY" ] || PY="$(command -v python3 || true)"

if [ -n "$PY" ] && command -v iconutil >/dev/null 2>&1; then
  echo "→ Gerando o ícone…"
  TEMP="$(mktemp -d)"
  ICONSET="$TEMP/cerebro.iconset"
  mkdir -p "$ICONSET"
  if "$PY" tools/criar_icone.py 1024 "$TEMP/base.png" >/dev/null; then
    for par in "16 16x16" "32 16x16@2x" "32 32x32" "64 32x32@2x" \
               "128 128x128" "256 128x128@2x" "256 256x256" \
               "512 256x256@2x" "512 512x512" "1024 512x512@2x"; do
      set -- $par
      sips -z "$1" "$1" "$TEMP/base.png" --out "$ICONSET/icon_$2.png" >/dev/null 2>&1
    done
    iconutil -c icns "$ICONSET" -o "$DESTINO/Contents/Resources/cerebro.icns" 2>/dev/null \
      && echo "${VERDE}✓${FIM} Ícone aplicado."
  fi
  rm -rf "$TEMP"
else
  echo "${AMARELO}!${FIM} Sem ícone personalizado (o app usa o ícone padrão)."
fi

touch "$DESTINO"  # força o Finder a reler o bundle

echo
echo "${VERDE}✓${FIM} Instalado em: $DESTINO"
echo
echo "Agora é só:"
echo "  1. Abrir o Finder → Aplicativos (ou a pasta ~/Applications)"
echo "  2. Duplo clique em “$NOME”"
echo "  3. Arrastar o ícone para o Dock, se quiser deixar fixo"
echo
echo "${AMARELO}Na primeira abertura${FIM} o macOS pode pedir confirmação:"
echo "  clique com o botão direito no app → Abrir → Abrir."
