import test from "node:test";
import assert from "node:assert/strict";
import { generateAnswer } from "../Src/ai/engine.js";

test("falls back from Gemini to OpenRouter-compatible provider when first provider fails", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes("generativelanguage.googleapis.com")) {
      return new Response(JSON.stringify({ error: { message: "quota exceeded" } }), { status: 429 });
    }
    return new Response(JSON.stringify({
      choices: [{ message: { content: "Xin chào từ POSTLAIN AI." } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const answer = await generateAnswer({
      AI_PROVIDER_ORDER: "gemini,openrouter",
      GEMINI_API_KEY: "test-gemini-key",
      OPENROUTER_API_KEY: "test-openrouter-key"
    }, "Xin chào");
    assert.equal(answer, "Xin chào từ POSTLAIN AI.");
    assert.equal(calls.length, 2);
    assert.match(calls[1], /openrouter.ai/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects an empty provider configuration without making a network request", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error("unexpected fetch"); };
  try {
    await assert.rejects(
      generateAnswer({}, "Xin chào"),
      /chưa được cấu hình/
    );
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects oversized questions before calling a provider", async () => {
  await assert.rejects(
    generateAnswer({}, "x".repeat(1801)),
    /1.800 ký tự/
  );
});

test("includes curated server knowledge in the provider system prompt", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Theo quy định server." }] } }] }), { status: 200 });
  };
  try {
    const answer = await generateAnswer({ GEMINI_API_KEY: "test-key", AI_PROVIDER_ORDER: "gemini" }, "Quy định là gì?", "Member phải tôn trọng nhau.");
    assert.equal(answer, "Theo quy định server.");
    assert.match(requestBody.systemInstruction.parts[0].text, /Member phải tôn trọng nhau/);
    assert.match(requestBody.systemInstruction.parts[0].text, /reference facts only/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
