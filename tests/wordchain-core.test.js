import test from "node:test";
import assert from "node:assert/strict";
import { VIETNAMESE_WORDS } from "../Src/wordlist.js";
import { VIETNAMESE_PLAYER_WORDS, VIETNAMESE_CURATED_WORDS } from "../Src/wordlist-player.js";
import {
  normalizeVietnamesePhrase,
  parseTwoSyllablePhrase,
  validateDictionaryPhrase,
  validateChainMove
} from "../Src/wordchain-core.js";

test("normalizes Vietnamese phrases without removing tone marks", () => {
  assert.equal(normalizeVietnamesePhrase("  CON GÀ!  "), "con gà");
  assert.equal(normalizeVietnamesePhrase("HỌC   SINH"), "học sinh");
});

test("accepts exactly two Vietnamese syllables and rejects other formats", () => {
  assert.equal(parseTwoSyllablePhrase("con gà").ok, true);
  assert.equal(parseTwoSyllablePhrase("học sinh").ok, true);
  assert.equal(parseTwoSyllablePhrase("con gà mái").code, "format");
  assert.equal(parseTwoSyllablePhrase("con").code, "format");
  assert.equal(parseTwoSyllablePhrase("con, gà").code, "format");
  assert.equal(parseTwoSyllablePhrase("con gà!").code, "format");
  assert.equal(parseTwoSyllablePhrase("😂 con gà").code, "format");
});

test("checks the complete phrase against the real bundled dictionary", () => {
  assert.equal(validateDictionaryPhrase("con gà", VIETNAMESE_WORDS).ok, true);
  assert.equal(validateDictionaryPhrase("con xyz", VIETNAMESE_WORDS).code, "not_found");
  assert.equal(validateDictionaryPhrase("từ mới", VIETNAMESE_WORDS, new Set(["từ mới"])).ok, true);
});

test("enforces chain, repeat and turn-taking rules", () => {
  const parsed = parseTwoSyllablePhrase("gà mái");
  assert.deepEqual(validateChainMove({
    parsed, currentTail: "gà", usedWords: ["con gà"], lastPlayerId: "1", userId: "2"
  }), { ok: true, nextTail: "mái" });
  assert.equal(validateChainMove({
    parsed, currentTail: "gà", usedWords: ["gà mái"], lastPlayerId: "1", userId: "2"
  }).code, "repeated");
  assert.equal(validateChainMove({
    parsed, currentTail: "con", usedWords: [], lastPlayerId: "1", userId: "2"
  }).code, "wrong_chain");
  assert.equal(validateChainMove({
    parsed, currentTail: "gà", usedWords: [], lastPlayerId: "2", userId: "2"
  }).code, "same_player");
});

test("expanded player dictionary includes attested common phrases and curated examples", () => {
  const dictionary = new Set([...VIETNAMESE_WORDS, ...VIETNAMESE_PLAYER_WORDS, ...VIETNAMESE_CURATED_WORDS]);
  assert.equal(validateDictionaryPhrase("gà mái", dictionary).ok, true);
  assert.equal(validateDictionaryPhrase("gái tây", dictionary).ok, true);
  assert.equal(validateDictionaryPhrase("tây tạng", dictionary).ok, true);
  assert.equal(validateDictionaryPhrase("con gà", dictionary).ok, true);
});
