'use strict';

/**
 * Tratamento dos nomes vindos do WhatsApp.
 *
 * O nome de um participante pode chegar de varias fontes e em qualidade muito
 * variada: "JOAO DA SILVA", "joao", "Joao 🚀 | Vendas", "+55 11 99999-9999" ou
 * simplesmente nada. Aqui normalizamos tudo para algo que possa ser usado numa
 * saudacao sem parecer robotico.
 */

// Preposicoes que ficam em minusculo no meio do nome.
const LOWERCASE_PARTICLES = new Set(['da', 'de', 'di', 'do', 'das', 'dos', 'e']);

/** Remove emojis, simbolos e ruido de separadores. */
function cleanRaw(value) {
  if (!value) return '';
  return String(value)
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}️]/gu, ' ')
    .replace(/[​-‏‪-‮]/g, '')
    .replace(/[|/\\•·*_~"']+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—.,:;]+|[\s\-–—.,:;]+$/g, '')
    .trim();
}

/** Nomes que na pratica nao servem para personalizar. */
function isUsable(name, number) {
  if (!name || name.length < 2) return false;
  const digits = name.replace(/\D/g, '');
  // "+55 11 99999-9999", "5511999999999" e afins nao sao nome.
  if (digits.length >= 8) return false;
  if (number && digits && number.includes(digits)) return false;
  // Precisa ter ao menos uma letra.
  if (!/\p{L}/u.test(name)) return false;
  return true;
}

/** "JOAO DA SILVA" e "joao da silva" viram "Joao da Silva". */
function toTitleCase(name) {
  const hasLower = /\p{Ll}/u.test(name);
  const hasUpper = /\p{Lu}/u.test(name);
  // Nome ja escrito de forma mista (ex.: "Ana Beatriz", "McDonald") fica como esta.
  if (hasLower && hasUpper) return name;

  return name
    .toLocaleLowerCase('pt-BR')
    .split(' ')
    .map((word, index) => {
      if (index > 0 && LOWERCASE_PARTICLES.has(word)) return word;
      return word.charAt(0).toLocaleUpperCase('pt-BR') + word.slice(1);
    })
    .join(' ');
}

/**
 * Escolhe o melhor nome disponivel de um contato do whatsapp-web.js.
 * Ordem: agenda do usuario > nome publico do contato > nome curto > perfil comercial.
 *
 * @param {object|null} contact objeto Contact do whatsapp-web.js
 * @param {string} [number] telefone, usado para descartar "nomes" que sao o proprio numero
 * @returns {{ name: string|null, firstName: string|null }}
 */
function resolveContactName(contact, number) {
  if (!contact) return { name: null, firstName: null };

  const candidates = [contact.name, contact.pushname, contact.shortName, contact.verifiedName];

  for (const candidate of candidates) {
    const cleaned = cleanRaw(candidate);
    if (!isUsable(cleaned, number)) continue;

    const name = toTitleCase(cleaned);
    const firstName = name.split(' ')[0];
    return { name, firstName };
  }

  return { name: null, firstName: null };
}

/**
 * Sem nome e sem texto alternativo o marcador some, e a frase precisa continuar
 * legivel: "Oi {primeiro_nome}, tudo bem?" tem que virar "Oi, tudo bem?" e nao
 * "Oi , tudo bem?".
 */
function tidyPunctuation(text) {
  return text
    .replace(/[^\S\n]{2,}/g, ' ')          // espacos duplicados
    .replace(/[^\S\n]+([,.!?;:])/g, '$1')  // " ," -> ","
    .replace(/(^|\n)[^\S\n]*[,;:][^\S\n]*/g, '$1') // linha comecando com pontuacao
    .replace(/[^\S\n]+\n/g, '\n')
    .trim();
}

/**
 * Substitui os marcadores do template pelos dados do destinatario.
 * Marcadores aceitos: {nome}, {primeiro_nome}, {numero}.
 *
 * @param {string} template texto configurado na interface
 * @param {{ name?: string|null, firstName?: string|null, number?: string }} recipient
 * @param {{ personalize?: boolean, fallbackName?: string }} options
 *   personalize=false faz todo mundo cair no fallback, para que um "{nome}"
 *   esquecido no texto nunca vaze literalmente para o destinatario.
 */
function renderTemplate(template, recipient, options = {}) {
  if (!template) return '';

  const { personalize = true, fallbackName = '' } = options;
  const fallback = cleanRaw(fallbackName);

  const name = personalize && recipient.name ? recipient.name : fallback;
  const firstName = personalize && (recipient.firstName || recipient.name)
    ? recipient.firstName || recipient.name
    : fallback;

  const rendered = template
    .replace(/\{nome\}/gi, name)
    .replace(/\{primeiro_nome\}/gi, firstName)
    .replace(/\{numero\}/gi, recipient.number ? `+${recipient.number}` : '');

  // So mexemos na pontuacao quando algum marcador virou vazio.
  const removeuMarcador = (!name || !firstName) && /\{(nome|primeiro_nome)\}/i.test(template);
  return removeuMarcador ? tidyPunctuation(rendered) : rendered;
}

module.exports = { resolveContactName, renderTemplate, tidyPunctuation, cleanRaw, toTitleCase, isUsable };
