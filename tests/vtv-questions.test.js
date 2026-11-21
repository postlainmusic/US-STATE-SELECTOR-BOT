import test from "node:test";
import assert from "node:assert/strict";
import { VTV_QUESTIONS, createVtvRound } from "../Src/vtv-questions.js";

test("Vua Tieng Viet question bank has unique IDs and valid answer indexes", () => {
  assert.ok(VTV_QUESTIONS.length >= 15);
  assert.equal(new Set(VTV_QUESTIONS.map(question => question.id)).size, VTV_QUESTIONS.length);
  for (const question of VTV_QUESTIONS) {
    assert.ok(question.prompt.length > 10);
    assert.equal(question.options.length, 4);
    assert.ok(question.answer >= 0 && question.answer < question.options.length);
    assert.ok(question.explanation.length > 5);
  }
});

test("quiz round returns a safe copy of a question", () => {
  const first = createVtvRound(0);
  assert.equal(first.id, VTV_QUESTIONS[0].id);
  first.options[0] = "changed";
  assert.notEqual(VTV_QUESTIONS[0].options[0], "changed");
  assert.equal(createVtvRound(0.999).id, VTV_QUESTIONS[VTV_QUESTIONS.length - 1].id);
});
