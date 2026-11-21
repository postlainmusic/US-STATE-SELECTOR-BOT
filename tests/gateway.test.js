import test from "node:test";
import assert from "node:assert/strict";
import { isExcludedChannel, classifySupportMessage, isProactiveCandidate } from "../Src/gateway.js";

const env = {
  SUPPORT_EXCLUDED_CHANNEL_IDS: "1571762668916707399,1571762812886192178"
};

test("excludes staff, moderation and private rooms", () => {
  assert.equal(isExcludedChannel("1571762668916707399", null, "staff-chat", "", env), true);
  assert.equal(isExcludedChannel("1571762812886192178", null, "mod-logs", "", env), true);
  assert.equal(isExcludedChannel("200", "100", "general-thread", "Staff", env), true);
  assert.equal(isExcludedChannel("201", null, "private-room", "", env), true);
  assert.equal(isExcludedChannel("300", null, "general", "", env), false);
});

test("routes common Vietnamese help phrases with accents and without accents", () => {
  assert.equal(classifySupportMessage("Mọi người ơi, cho mình hỏi chọn bang ở đâu?")?.key, "state-role");
  assert.equal(classifySupportMessage("co ai biet cach verify khong")?.key, "verification-role");
  assert.equal(classifySupportMessage("Cho mình hỏi, Discord bị lỗi đăng nhập")?.key, "discord-account");
  assert.equal(classifySupportMessage("Help, mic voice không hoạt động")?.key, "music-audio");
  assert.equal(classifySupportMessage("Mình cần report spam")?.key, "safety-report");
  assert.equal(classifySupportMessage("Cho mình hỏi cách gửi góp ý")?.key, "feedback");
});

test("generic help and technical errors receive useful next steps", () => {
  assert.equal(classifySupportMessage("Cho mình hỏi với")?.key, "general-help");
  assert.equal(classifySupportMessage("Lỗi không kết nối được")?.key, "technical-issue");
  assert.equal(classifySupportMessage("lỗi")?.key, "technical-issue");
  assert.equal(isProactiveCandidate("Ai biết cách đổi tên Discord không?"), true);
});

test("ordinary chat and non-help banter are ignored", () => {
  assert.equal(classifySupportMessage("Haha hôm nay vui ghê :)))"), null);
  assert.equal(classifySupportMessage("Mày ăn cơm chưa?"), null);
  assert.equal(classifySupportMessage("Chào cả nhà!"), null);
  assert.equal(classifySupportMessage(""), null);
});
