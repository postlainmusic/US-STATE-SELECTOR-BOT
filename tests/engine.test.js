import test from "node:test";
import assert from "node:assert/strict";
import { generateAnswer } from "../Src/ai/engine.js";

test("passes recent community context to the AI system prompt", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "Đã nhận ngữ cảnh." }] } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const answer = await generateAnswer(
      { GEMINI_API_KEY: "test-key", AI_PROVIDER_ORDER: "gemini" },
      "Mọi người vừa thống nhất điều gì?",
      "Quy định: tôn trọng thành viên.",
      "[#general] Member: Tối nay nghe nhạc indie nhé."
    );
    assert.equal(answer, "Đã nhận ngữ cảnh.");
    assert.match(requestBody.systemInstruction.parts[0].text, /ADMIN-CURATED POSTLAIN SERVER KNOWLEDGE/);
    assert.match(requestBody.systemInstruction.parts[0].text, /RECENT COMMUNITY CONVERSATION CONTEXT/);
    assert.match(requestBody.systemInstruction.parts[0].text, /Tối nay nghe nhạc indie/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not require community context for ordinary AI questions", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "Xin chào!" }] } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const answer = await generateAnswer(
      { GEMINI_API_KEY: "test-key", AI_PROVIDER_ORDER: "gemini" },
      "Xin chào"
    );
    assert.equal(answer, "Xin chào!");
    assert.doesNotMatch(requestBody.systemInstruction.parts[0].text, /RECENT COMMUNITY CONVERSATION CONTEXT/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
