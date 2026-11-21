import test from "node:test";
import assert from "node:assert/strict";
import { isExcludedChannel, shouldStoreMessage, isProactiveCandidate } from "../Src/gateway.js";

const env = {
  AI_EXCLUDED_CHANNEL_IDS: "1571762668916707399,1571762812886192178",
  KNOWLEDGE_CHANNEL_ID: "1573550240949338282"
};

test("excludes the configured staff and moderation rooms", () => {
  assert.equal(isExcludedChannel("1571762668916707399", null, "staff-chat", "", env), true);
  assert.equal(isExcludedChannel("1571762812886192178", null, "mod-logs", "", env), true);
});

test("excludes knowledge storage and private categories", () => {
  assert.equal(isExcludedChannel("1573550240949338282", null, "knowledge", "", env), true);
  assert.equal(isExcludedChannel("200", "100", "general-thread", "Staff", env), true);
  assert.equal(isExcludedChannel("201", null, "private-room", "", env), true);
});

test("allows an ordinary community room", () => {
  assert.equal(isExcludedChannel("300", null, "general", "", env), false);
});

test("stores only text messages from this guild in allowed channels", () => {
  const allowed = message => false;
  const base = {
    guild_id: "guild-1",
    channel_id: "channel-1",
    author: { id: "member-1", username: "Member", bot: false },
    content: "Hello community",
    type: 0
  };
  assert.equal(shouldStoreMessage(base, "guild-1", allowed), true);
  assert.equal(shouldStoreMessage({ ...base, guild_id: "other-guild" }, "guild-1", allowed), false);
  assert.equal(shouldStoreMessage({ ...base, author: { bot: true } }, "guild-1", allowed), false);
  assert.equal(shouldStoreMessage({ ...base, content: " " }, "guild-1", allowed), false);
  assert.equal(shouldStoreMessage(base, "guild-1", () => true), false);
});

test("proactive detection selects help requests and conflict signals", () => {
  assert.equal(isProactiveCandidate("Cho hỏi mọi người, đăng ký role bang ở đâu vậy?"), true);
  assert.equal(isProactiveCandidate("Có ai biết cách đổi tên Discord không?"), true);
  assert.equal(isProactiveCandidate("Mọi người bình tĩnh lại, đừng công kích nhau nữa."), true);
});

test("proactive detection ignores ordinary banter and unrelated questions", () => {
  assert.equal(isProactiveCandidate("Haha hôm nay vui ghê :)))"), false);
  assert.equal(isProactiveCandidate("Mày ăn cơm chưa?"), false);
  assert.equal(isProactiveCandidate("Chào cả nhà!"), false);
});
