'use strict';

/**
 * Variacao de texto.
 *
 * Centenas de mensagens byte a byte identicas sao um dos sinais mais obvios de
 * automacao. Duas formas de variar, combinaveis:
 *
 *   1. Variantes completas, separadas por uma linha com "---":
 *        Oi {primeiro_nome}, tudo bem?
 *        ---
 *        Ola {primeiro_nome}! Como voce esta?
 *
 *   2. Spintax dentro do texto:
 *        {Oi|Ola|Bom dia} {primeiro_nome}, {tudo bem|como vai}?
 *
 * As chaves do spintax so sao interpretadas quando ha uma barra vertical
 * dentro delas, entao {nome} e {primeiro_nome} continuam funcionando.
 */

const VARIANT_SEPARATOR = /^\s*-{3,}\s*$/m;

/** Divide o texto em variantes completas. */
function splitVariants(text) {
  if (!text) return [''];
  return String(text)
    .split(VARIANT_SEPARATOR)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Resolve {a|b|c} escolhendo uma opcao ao acaso, de dentro para fora. */
function resolveSpintax(text) {
  if (!text || !text.includes('|')) return text;

  const pattern = /\{([^{}]*\|[^{}]*)\}/;
  let out = String(text);
  let guard = 0;

  while (pattern.test(out) && guard < 50) {
    out = out.replace(pattern, (_match, group) => {
      const options = group.split('|');
      return options[Math.floor(Math.random() * options.length)];
    });
    guard += 1;
  }

  return out;
}

/** Escolhe uma variante e resolve o spintax dela. */
function pickVariant(text) {
  const variants = splitVariants(text);
  const chosen = variants[Math.floor(Math.random() * variants.length)];
  return resolveSpintax(chosen);
}

/** Quantas combinacoes distintas o texto pode gerar (limitado, so para exibir). */
function countCombinations(text) {
  const variants = splitVariants(text);
  let total = 0;

  for (const variant of variants) {
    let combos = 1;
    const matches = variant.match(/\{[^{}]*\|[^{}]*\}/g) || [];
    for (const match of matches) {
      combos *= match.slice(1, -1).split('|').length;
      if (combos > 100000) return 100000;
    }
    total += combos;
  }

  return total;
}

/** Anexa a linha de descadastro, sem duplicar se ja existir. */
function appendOptOut(text, footer) {
  const clean = (footer || '').trim();
  if (!clean) return text;
  if (text && text.toLowerCase().includes(clean.toLowerCase())) return text;
  return text ? `${text}\n\n${clean}` : clean;
}

module.exports = { pickVariant, splitVariants, resolveSpintax, countCombinations, appendOptOut };
