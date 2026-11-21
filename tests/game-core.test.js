import test from "node:test";
import assert from "node:assert/strict";
import { BAU_CUA_ANIMALS, calculateBauCuaResult, getDailyReward, getVietnamDateKey, getRankLabel } from "../Src/game-core.js";

test("daily reward grows with consecutive check-ins and is capped", () => {
  assert.equal(getDailyReward(1), 350);
  assert.equal(getDailyReward(2), 400);
  assert.equal(getDailyReward(14), 1000);
  assert.equal(getDailyReward(99), 1000);
});

test("Vietnam daily reset uses Asia/Ho_Chi_Minh calendar date", () => {
  assert.equal(getVietnamDateKey(Date.parse("2026-11-21T16:59:00Z")), "2026-11-21");
  assert.equal(getVietnamDateKey(Date.parse("2026-11-21T17:00:00Z")), "2026-11-22");
});

test("Bau Cua pays stake plus one stake per matching die", () => {
  assert.equal(calculateBauCuaResult({ animal: "ca", amount: 100, dice: ["ca", "tom", "nai"] }).payout, 200);
  assert.equal(calculateBauCuaResult({ animal: "ca", amount: 100, dice: ["ca", "ca", "nai"] }).payout, 300);
  assert.equal(calculateBauCuaResult({ animal: "ca", amount: 100, dice: ["ca", "ca", "ca"] }).payout, 400);
  assert.equal(calculateBauCuaResult({ animal: "ca", amount: 100, dice: ["bau", "tom", "nai"] }).payout, 0);
});

test("Bau Cua validates bet and dice input", () => {
  assert.equal(calculateBauCuaResult({ animal: "dragon", amount: 100, dice: ["ca", "tom", "nai"] }).code, "invalid_animal");
  assert.equal(calculateBauCuaResult({ animal: "ca", amount: 9, dice: ["ca", "tom", "nai"] }).code, "invalid_amount");
  assert.equal(calculateBauCuaResult({ animal: "ca", amount: 100, dice: ["ca"] }).code, "invalid_dice");
  assert.equal(BAU_CUA_ANIMALS.length, 6);
});

test("rank label is safe for missing rank", () => {
  assert.equal(getRankLabel(1), "#1");
  assert.equal(getRankLabel(0), "Chưa xếp hạng");
});
