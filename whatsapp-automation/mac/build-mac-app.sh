#!/bin/bash
#
# Monta o bundle "WhatsApp Automation.app" e o .zip de distribuicao.
# Roda tanto no macOS quanto no Linux (o bundle e so estrutura de pastas).
#
#   ./mac/build-mac-app.sh          -> dist/WhatsApp Automation.app + dist/*.zip
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE_SRC="$ROOT/mac/bundle"
DIST="$ROOT/dist"
APP="$DIST/WhatsApp Automation.app"
ZIP="$DIST/WhatsApp-Automation-mac.zip"

echo "==> Limpando $DIST"
rm -rf "$DIST"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/app"

echo "==> Copiando estrutura do bundle"
cp "$BUNDLE_SRC/Contents/Info.plist"           "$APP/Contents/Info.plist"
cp "$BUNDLE_SRC/Contents/MacOS/launcher"       "$APP/Contents/MacOS/launcher"
cp "$ROOT/mac/app.icns"                        "$APP/Contents/Resources/app.icns"
printf 'APPL????' > "$APP/Contents/PkgInfo"
chmod +x "$APP/Contents/MacOS/launcher"

echo "==> Copiando o codigo da aplicacao"
# node_modules NAO vai no bundle: e instalado no primeiro uso, no Mac do usuario.
cp -R "$ROOT/server.js" "$ROOT/src" "$ROOT/public" "$ROOT/package.json" \
      "$ROOT/package-lock.json" "$ROOT/README.md" "$APP/Contents/Resources/app/"

echo "==> Gerando $ZIP"
cd "$DIST"
# -y preserva symlinks; o zip mantem o bit de execucao do launcher
zip -qry "$(basename "$ZIP")" "$(basename "$APP")"

echo
echo "Pronto:"
echo "  $APP"
echo "  $ZIP  ($(du -h "$ZIP" | cut -f1))"
