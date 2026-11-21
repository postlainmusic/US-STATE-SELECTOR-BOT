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

test("recognizes broader English and Vietnamese support categories", () => {
  assert.equal(classifySupportMessage("I can't hear anyone in voice")?.key, "voice-audio");
  assert.equal(classifySupportMessage("Where can I find the state selector?")?.key, "state-role");
  assert.equal(classifySupportMessage("I got scammed by someone")?.key, "safety-report");
  assert.equal(classifySupportMessage("How do I join the event?")?.key, "events-community");
  assert.equal(classifySupportMessage("Discord app keeps crashing")?.key, "discord-account");
  assert.equal(classifySupportMessage("Cho mình hỏi cách verify thành viên")?.key, "verification-access");
});

test("returns language-aware support guidance and follow-up prompts", () => {
  const vi = classifySupportMessage("Mình không nghe được trong voice");
  const en = classifySupportMessage("I cannot hear anything in voice");
  assert.match(vi.response, /Voice/);
  assert.match(vi.followUp, /mic|loa|tai nghe/i);
  assert.match(en.response, /Voice/);
  assert.match(en.followUp, /microphone|speakers/i);
});

test("safety reports outrank generic technical keywords", () => {
  assert.equal(classifySupportMessage("Help, report lỗi lừa đảo")?.key, "safety-report");
});
