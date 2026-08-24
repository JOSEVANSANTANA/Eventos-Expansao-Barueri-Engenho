#!/bin/bash
cd "$(dirname "$0")" || exit 1

echo ""
echo "  ================================================"
echo "   RADAR INSTITUCIONAL"
echo "  ================================================"
echo ""
echo "  Iniciando... o navegador abre sozinho em 2 segundos."
echo ""
echo "  NAO FECHE ESTA JANELA enquanto estiver usando."
echo "  Para encerrar, pressione Ctrl+C."
echo ""

if ! command -v python3 >/dev/null 2>&1; then
  echo "  Python 3 nao encontrado."
  echo ""
  echo "  Duas opcoes:"
  echo "    1) Instale em https://python.org/downloads"
  echo "    2) Ou use o Radar-Institucional-STANDALONE.html (duplo clique)"
  echo ""
  read -r -p "  Pressione Enter para fechar."
  exit 1
fi

( sleep 2
  if command -v open >/dev/null 2>&1; then open http://localhost:8080
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open http://localhost:8080
  fi ) &

python3 -m http.server 8080
