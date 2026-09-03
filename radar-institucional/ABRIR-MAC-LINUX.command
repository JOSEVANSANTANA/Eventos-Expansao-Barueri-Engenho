#!/bin/bash
cd "$(dirname "$0")" || exit 1

echo ""
echo "  ================================================"
echo "   RADAR INSTITUCIONAL"
echo "  ================================================"
echo ""

# Testa executando, nao so procurando: em algumas instalacoes o python3 no PATH
# e um atalho quebrado que existe mas nao roda.
PY=""
for candidato in python3 python; do
  if "$candidato" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 7) else 1)' >/dev/null 2>&1; then
    PY="$candidato"
    break
  fi
done

if [ -z "$PY" ]; then
  echo "  Python 3 nao encontrado."
  echo ""
  echo "  Duas opcoes:"
  echo "    1) Instale em https://python.org/downloads"
  echo "    2) Ou use o Radar-Institucional-STANDALONE.html (duplo clique)"
  echo ""
  read -r -p "  Pressione Enter para fechar."
  exit 1
fi

echo "  Python encontrado: $PY"
echo ""
echo "  NAO FECHE ESTA JANELA enquanto estiver usando."
echo "  Ctrl+C encerra. O navegador abre sozinho quando estiver pronto."
echo ""

# O servidor abre o navegador sozinho, depois de conferir que a porta responde.
"$PY" servidor.py 8080
