export function normalizeVietnamesePhrase(value) {
  return String(value || "")
    .normalize("NFC")
    .toLocaleLowerCase("vi-VN")
    .trim()
    .replace(/\s+/gu, " ");
}

export function parseTwoSyllablePhrase(value) {
  const phrase = normalizeVietnamesePhrase(value);
  if (!phrase || phrase.length > 80) return { ok: false, code: "empty" };
  const parts = phrase.split(" ");
  if (parts.length !== 2 || parts.some(part => !/^\p{L}+$/u.test(part))) {
    return { ok: false, code: "format", phrase, parts };
  }
  return { ok: true, phrase, first: parts[0], last: parts[1] };
}

export function validateDictionaryPhrase(value, dictionary, customDictionary = new Set()) {
  const parsed = parseTwoSyllablePhrase(value);
  if (!parsed.ok) return parsed;
  if (!dictionary.has(parsed.phrase) && !customDictionary.has(parsed.phrase)) {
    return { ...parsed, ok: false, code: "not_found" };
  }
  return parsed;
}

export function validateChainMove({ parsed, currentTail, usedWords = [], lastPlayerId, userId }) {
  if (!parsed?.ok) return { ok: false, code: parsed?.code || "invalid" };
  if (lastPlayerId && String(lastPlayerId) === String(userId)) {
    return { ok: false, code: "same_player" };
  }
  if (usedWords.includes(parsed.phrase)) return { ok: false, code: "repeated" };
  if (currentTail && parsed.first !== currentTail) {
    return { ok: false, code: "wrong_chain", expected: currentTail };
  }
  return { ok: true, nextTail: parsed.last };
}
