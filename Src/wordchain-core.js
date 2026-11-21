export function normalizeVietnamesePhrase(value) {
  return String(value || "")
    .normalize("NFC")
    .toLocaleLowerCase("vi-VN")
    .trim()
    .replace(/\s+/gu, " ");
}

export function parseTwoSyllablePhrase(value, language = "vi") {
  const phrase = normalizeVietnamesePhrase(value);
  if (!phrase || phrase.length > 80) return { ok: false, code: "empty", language };
  const parts = phrase.split(" ");
  const validToken = language === "en" ? /^[a-z]+$/u : /^\p{L}+$/u;
  if (parts.length !== 2 || parts.some(part => !validToken.test(part))) {
    return { ok: false, code: "format", phrase, parts, language };
  }
  return { ok: true, phrase, first: parts[0], last: parts[1], language };
}

export function classifyWordChainPhrase(value, dictionary, customDictionary = new Set(), language = "vi") {
  const parsed = parseTwoSyllablePhrase(value, language);
  if (!parsed.ok) return { ...parsed, verdict: "invalid" };
  if (dictionary.has(parsed.phrase) || customDictionary.has(parsed.phrase)) {
    return { ...parsed, ok: true, verdict: "accepted" };
  }
  return { ...parsed, ok: false, code: "not_found", verdict: "unverified" };
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
