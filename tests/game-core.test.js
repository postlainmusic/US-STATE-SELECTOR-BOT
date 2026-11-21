import test from "node:test";
import assert from "node:assert/strict";
import { BAU_CUA_ANIMALS, calculateBauCuaResult, getDailyReward, getVietnamDateKey, getRankLabel, buildWordChainReplyIndex, chooseWordChainReply, resolveXuxi, rollBauCuaDice, chooseXuxiBotChoice, GRIND_GAMES, calculateGrindReward } from "../Src/game-core.js";

test("daily reward is a fixed 100,000 Gold regardless of streak", () => {
  assert.equal(getDailyReward(1), 100000);
  assert.equal(getDailyReward(2), 100000);
  assert.equal(getDailyReward(99), 100000);
});

test("Vietnam daily reset uses Asia/Ho_Chi_Minh calendar date", () => {
  assert.equal(getVietnamDateKey(Date.parse("2026-11-21T16:59:00Z")), "2026-11-21");
  assert.equal(getVietnamDateKey(Date.parse("2026-11-21T17:00:00Z")), "2026-11-22");
});

test("Bau Cua pays a fixed 2x total on a hit to keep the 48 percent game economy bounded", () => {
  assert.equal(calculateBauCuaResult({ animal: "ca", amount: 100, dice: ["ca", "tom", "nai"] }).payout, 200);
  assert.equal(calculateBauCuaResult({ animal: "ca", amount: 100, dice: ["ca", "ca", "nai"] }).payout, 200);
  assert.equal(calculateBauCuaResult({ animal: "ca", amount: 100, dice: ["ca", "ca", "ca"] }).payout, 200);
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

test("bot reply index only contains two-syllable phrases and follows the required tail", () => {
  const index = buildWordChainReplyIndex(["bản đồ", "bản thân", "đồ chơi", "bản đồ giấy", "BẢN   ĐỒ"]);
  assert.deepEqual(index.get("bản"), ["bản đồ", "bản thân"]);
  assert.equal(chooseWordChainReply(index, "bản", [], 0), "bản đồ");
  assert.equal(chooseWordChainReply(index, "bản", [], 0.99), "bản thân");
});

test("bot never repeats a phrase already used in the current round", () => {
  const index = buildWordChainReplyIndex(["đồ chơi", "đồ ăn"]);
  assert.equal(chooseWordChainReply(index, "đồ", ["đồ chơi"], 0), "đồ ăn");
  assert.equal(chooseWordChainReply(index, "đồ", ["đồ chơi", "đồ ăn"]), null);
});

test("xu-xi resolves rock paper scissors and virtual stakes", () => {
  assert.equal(resolveXuxi({ choice: "bua", botChoice: "keo", amount: 100 }).outcome, "win");
  assert.equal(resolveXuxi({ choice: "bua", botChoice: "bao", amount: 100 }).net, -100);
  assert.equal(resolveXuxi({ choice: "bao", botChoice: "bao", amount: 100 }).net, 0);
  assert.equal(resolveXuxi({ choice: "keo", botChoice: "bao", amount: 0 }).code, "invalid_amount");
  assert.equal(resolveXuxi({ choice: "dragon", botChoice: "bao", amount: 100 }).code, "invalid_choice");
});

test("Bau Cua dice generator guarantees the selected animal on a win and excludes it on a loss", () => {
  const winning = [0.1, 0.1, 0.2, 0.3, 0.4];
  const losing = [0.9, 0.1, 0.2, 0.3];
  const winDice = rollBauCuaDice("ca", () => winning.shift() ?? 0.2);
  const loseDice = rollBauCuaDice("ca", () => losing.shift() ?? 0.2);
  assert.equal(winDice.length, 3);
  assert.ok(winDice.includes("ca"));
  assert.equal(loseDice.length, 3);
  assert.ok(loseDice.every(value => value !== "ca"));
});

test("Xuxi bot choice is weighted so the player wins 48 percent and loses 52 percent", () => {
  for (const choice of ["bua", "keo", "bao"]) {
    const winBot = chooseXuxiBotChoice(choice, () => 0.2);
    const loseBot = chooseXuxiBotChoice(choice, () => 0.8);
    assert.equal(resolveXuxi({ choice, botChoice: winBot.value, amount: 100 }).outcome, "win");
    assert.equal(resolveXuxi({ choice, botChoice: loseBot.value, amount: 100 }).outcome, "loss");
  }
});


test("four grind games have cooldowns, daily caps and non-betting rewards", () => {
  assert.deepEqual(Object.keys(GRIND_GAMES), ["mining", "fishing", "farming", "expedition"]);
  assert.equal(GRIND_GAMES.mining.dailyCap, 12000);
  assert.equal(GRIND_GAMES.fishing.cooldownMs, 20 * 60 * 1000);
  assert.equal(GRIND_GAMES.farming.cooldownMs, 4 * 60 * 60 * 1000);
  assert.equal(GRIND_GAMES.expedition.dailyCap, 12000);
  assert.equal(calculateGrindReward("mining", () => 0).total, 1600);
  assert.equal(calculateGrindReward("unknown"), null);
});

test("grind rare rewards stay within configured reward ranges", () => {
  const reward = calculateGrindReward("fishing", () => 0);
  assert.equal(reward.base, 400);
  assert.equal(reward.bonus, 1000);
  assert.equal(reward.total, 1400);
  assert.ok(reward.total <= GRIND_GAMES.fishing.maxReward + GRIND_GAMES.fishing.bonusMax);
});
