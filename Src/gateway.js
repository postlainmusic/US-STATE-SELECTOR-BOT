import { VIETNAMESE_WORDS } from "./wordlist.js";
import { VIETNAMESE_PLAYER_WORDS, VIETNAMESE_CURATED_WORDS } from "./wordlist-player.js";
import { normalizeVietnamesePhrase, parseTwoSyllablePhrase, validateDictionaryPhrase, validateChainMove } from "./wordchain-core.js";
const DISCORD_API = "https://discord.com/api/v10";
const DEFAULT_EXCLUDED_CHANNELS = new Set([
  "1571762668916707399", // Staff chat
  "1571762812886192178"  // Mod logs
]);
const PRIVATE_NAME = /(^|[-_ ])(staff|admin|moderation|modlog|mod-logs|ticket|private|internal)([-_ ]|$)/i;
const MAX_MESSAGE_LENGTH = 1800;
const WORD_CHAIN_CHANNEL_ID = "1573644570997035100";
const WORD_CHAIN_TURN_MS = 30_000;
const WORD_CHAIN_DICTIONARY = new Set([...VIETNAMESE_WORDS, ...VIETNAMESE_PLAYER_WORDS, ...VIETNAMESE_CURATED_WORDS]);

export { classifySupportMessage, isHelpRequest, isProactiveCandidate } from "./support/engine.js";
import { classifySupportMessage } from "./support/engine.js";

function parseIds(value) {
  return String(value || "").split(",").map(x => x.trim()).filter(Boolean);
}

export function isExcludedChannel(channelId, parentId, channelName, parentName, env = {}) {
  const excluded = new Set([...DEFAULT_EXCLUDED_CHANNELS, ...parseIds(env.SUPPORT_EXCLUDED_CHANNEL_IDS)].filter(Boolean));
  if (excluded.has(String(channelId)) || (parentId && excluded.has(String(parentId)))) return true;
  if (PRIVATE_NAME.test(String(channelName || "")) || PRIVATE_NAME.test(String(parentName || ""))) return true;
  return false;
}

export class DiscordGateway {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.ws = null;
    this.heartbeatTimer = null;
    this.heartbeatInterval = 0;
    this.awaitingAck = false;
    this.seq = null;
    this.sessionId = null;
    this.resumeUrl = null;
    this.lastError = null;
    this.lastGatewayPacketAt = null;
    this.lastGatewayEvent = null;
    this.lastCloseCode = null;
    this.lastCloseReason = null;
    this.isReady = false;
    this.readyAt = null;
    this.channelNames = new Map();
    this.channelParents = new Map();
    this.ctx.storage.sql.exec("DROP TABLE IF EXISTS community_messages");
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS proactive_replies (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        author_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    this.ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS idx_proactive_replies_time ON proactive_replies(created_at)");
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS support_sessions (
        channel_id TEXT NOT NULL,
        author_id TEXT NOT NULL,
        category TEXT NOT NULL,
        source_message_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (channel_id, author_id)
      )
    `);
    this.ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS idx_support_sessions_created ON support_sessions(created_at)");
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS word_chain_games (
        channel_id TEXT PRIMARY KEY, active INTEGER NOT NULL, starter_id TEXT NOT NULL,
        current_tail TEXT, used_words TEXT NOT NULL, last_player_id TEXT,
        moves INTEGER NOT NULL DEFAULT 0, last_move_at INTEGER NOT NULL
      )`);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS word_chain_scores (
        user_id TEXT PRIMARY KEY, wins INTEGER NOT NULL DEFAULT 0,
        losses INTEGER NOT NULL DEFAULT 0, moves INTEGER NOT NULL DEFAULT 0
      )`);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS word_chain_custom_words (
        phrase TEXT PRIMARY KEY, added_by TEXT NOT NULL, added_at INTEGER NOT NULL
      )`);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS word_chain_suggestions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, phrase TEXT NOT NULL,
        submitted_by TEXT NOT NULL, submitted_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
      )`);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS word_chain_processed_messages (message_id TEXT PRIMARY KEY, processed_at INTEGER NOT NULL)`);

  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/ensure") {
      await this.connect();
      return Response.json({
        ok: !this.lastError,
        state: this.ws?.readyState === WebSocket.OPEN ? "connected" : "connecting",
        lastError: this.lastError
      });
    }
    if (url.pathname === "/status") {
      const socketState = this.ws?.readyState;
      const state = socketState === WebSocket.OPEN ? "connected" : socketState === WebSocket.CONNECTING ? "connecting" : "disconnected";
      return Response.json({
        ok: true,
        state,
        socketReadyState: socketState ?? null,
        guildId: this.env.DISCORD_GUILD_ID,
        lastError: this.lastError,
        lastGatewayPacketAt: this.lastGatewayPacketAt,
        lastGatewayEvent: this.lastGatewayEvent,
        lastCloseCode: this.lastCloseCode,
        lastCloseReason: this.lastCloseReason,
        ready: this.isReady,
        readyAt: this.readyAt,
        hasBotToken: Boolean(this.env.DISCORD_BOT_TOKEN)
      });
    }

    if (url.pathname === "/wordchain/start" && request.method === "POST") {
      await this.connect();
      const payload = await request.json();
      const userId = String(payload.userId || "");
      if (!userId) return Response.json({ ok: false, message: "Không xác định được người chơi." }, { status: 400 });
      const current = this.ctx.storage.sql.exec("SELECT active FROM word_chain_games WHERE channel_id = ?", WORD_CHAIN_CHANNEL_ID).toArray()[0];
      if (current?.active) return Response.json({ ok: false, message: "🎮 Đang có một ván nối từ diễn ra rồi. Cứ vào chơi thôi!" });
      this.ctx.storage.sql.exec(
        "INSERT OR REPLACE INTO word_chain_games (channel_id, active, starter_id, current_tail, used_words, last_player_id, moves, last_move_at) VALUES (?, 1, ?, NULL, '[]', NULL, 0, ?)",
        WORD_CHAIN_CHANNEL_ID, userId, Date.now());
      return Response.json({ ok: true, message: "🎮 **Ván nối từ POSTLAIN bắt đầu!**\nMọi người gửi cụm từ tiếng Việt đúng 2 tiếng. Người tiếp theo phải bắt đầu bằng tiếng cuối của cụm trước. Chỉ nhận cụm có trong từ điển, không lặp từ, không tự đi hai lượt liên tiếp. Mỗi lượt có 30 giây. Không cần dùng lệnh để bắt đầu, chỉ cần gửi cụm từ vào kênh.\n\n🏁 <@" + userId + "> đã mở ván. Ai đi trước cũng được!" });
    }
    if (url.pathname === "/wordchain/end" && request.method === "POST") {
      const payload = await request.json();
      const userId = String(payload.userId || "");
      const current = this.ctx.storage.sql.exec("SELECT active, starter_id FROM word_chain_games WHERE channel_id = ?", WORD_CHAIN_CHANNEL_ID).toArray()[0];
      if (!current?.active) return Response.json({ ok: false, message: "Hiện không có ván nào đang diễn ra." });
      if (String(current.starter_id) !== userId && !payload.isAdmin) return Response.json({ ok: false, message: "Chỉ người mở ván hoặc Admin mới được kết thúc." });
      this.ctx.storage.sql.exec("UPDATE word_chain_games SET active = 0 WHERE channel_id = ?", WORD_CHAIN_CHANNEL_ID);
      return Response.json({ ok: true, message: "🛑 Đã kết thúc ván nối từ. Dùng /noitu score để xem bảng xếp hạng." });
    }
    if ((url.pathname === "/wordchain/score" || url.pathname === "/wordchain/leaderboard") && request.method === "GET") {
      const rows = this.ctx.storage.sql.exec("SELECT user_id, wins, losses, moves FROM word_chain_scores ORDER BY wins DESC, moves DESC LIMIT 20").toArray();
      if (!rows.length) return Response.json({ message: "🏆 Bảng xếp hạng chưa có dữ liệu. Vào phòng nối từ và gửi một cụm 2 tiếng hợp lệ để bắt đầu nhé!" });
      const lines = rows.map((row, index) => (index + 1) + ". <@" + row.user_id + "> · **" + row.wins + " thắng** · " + row.losses + " thua · " + row.moves + " lượt");
      return Response.json({ message: "🏆 **POSTLAIN NỐI TỪ · TOP 20**\n" + lines.join("\n") });
    }
    if (url.pathname === "/wordchain/profile" && request.method === "GET") {
      const userId = String(url.searchParams.get("userId") || "");
      if (!userId) return Response.json({ message: "Không xác định được người chơi." }, { status: 400 });
      const row = this.ctx.storage.sql.exec("SELECT wins, losses, moves FROM word_chain_scores WHERE user_id = ?", userId).toArray()[0];
      if (!row) return Response.json({ message: "👤 Người chơi này chưa có thống kê nối từ. Vào phòng game và chơi một lượt nhé!" });
      const rank = this.ctx.storage.sql.exec("SELECT COUNT(*) + 1 AS rank FROM word_chain_scores WHERE wins > ? OR (wins = ? AND moves > ?)", Number(row.wins), Number(row.wins), Number(row.moves)).toArray()[0]?.rank || 1;
      return Response.json({ message: "👤 **HỒ SƠ NỐI TỪ**\n<@" + userId + ">\n🏆 Thắng: **" + row.wins + "**\n💔 Thua: **" + row.losses + "**\n🔗 Lượt hợp lệ: **" + row.moves + "**\n📊 Xếp hạng: **#" + rank + "**" });
    }
    if (url.pathname === "/wordchain/add-word" && request.method === "POST") {
      const payload = await request.json();
      if (!payload.isAdmin) return Response.json({ ok: false, message: "Chỉ Admin mới được bổ sung từ điển." }, { status: 403 });
      const parsed = parseTwoSyllablePhrase(payload.word);
      if (!parsed.ok) return Response.json({ ok: false, message: "Từ bổ sung phải có đúng 2 tiếng tiếng Việt." }, { status: 400 });
      if (VIETNAMESE_WORDS.has(parsed.phrase)) return Response.json({ ok: true, message: "Cụm này đã có sẵn trong từ điển gốc." });
      this.ctx.storage.sql.exec("INSERT OR IGNORE INTO word_chain_custom_words (phrase, added_by, added_at) VALUES (?, ?, ?)", parsed.phrase, String(payload.userId || "admin"), Date.now());
      return Response.json({ ok: true, message: "📚 Đã bổ sung **" + parsed.phrase + "** vào từ điển POSTLAIN. Từ này có thể dùng ngay." });
    }
    return new Response("Not found", { status: 404 });
  }

  async alarm() {
    const timedGame = this.ctx.storage.sql.exec(
      "SELECT current_tail, last_player_id, last_move_at FROM word_chain_games WHERE channel_id = ? AND active = 1",
      WORD_CHAIN_CHANNEL_ID
    ).toArray()[0];
    if (timedGame?.current_tail && Date.now() - Number(timedGame.last_move_at) >= WORD_CHAIN_TURN_MS) {
      this.ctx.storage.sql.exec("UPDATE word_chain_games SET active = 0 WHERE channel_id = ?", WORD_CHAIN_CHANNEL_ID);
      const winnerId = String(timedGame.last_player_id || "");
      if (winnerId) this.ctx.storage.sql.exec(
        "INSERT INTO word_chain_scores (user_id, wins, losses, moves) VALUES (?, 1, 0, 0) ON CONFLICT(user_id) DO UPDATE SET wins = wins + 1",
        winnerId
      );
      await this.sendWordChainMessage(WORD_CHAIN_CHANNEL_ID,
        "⏰ Hết 30 giây! Ván nối từ đã kết thúc. " + (winnerId ? "<@" + winnerId + "> thắng vì là người nối hợp lệ cuối cùng." : "Không có người thắng.") + " Gửi một cụm 2 tiếng hợp lệ vào kênh để tự mở ván mới."
      );
    }
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      try { this.ws.close(4000, "Scheduled gateway rotation"); } catch {}
      this.ws = null;
      this.clearHeartbeat();
      await this.ctx.storage.setAlarm(Date.now() + 3000);
      return;
    }
    await this.connect();
  }

  async connect() {
    const savedSession = await this.ctx.storage.get("gateway_session");
    // A previous Gateway session may have been identified with message-reading intents.
    // Force a fresh IDENTIFY so Discord applies the reduced GUILDS-only intent set.
    if (savedSession && savedSession.intents !== 33281) {
      this.sessionId = null;
      this.seq = null;
      this.resumeUrl = null;
      await this.ctx.storage.delete("gateway_session");
    } else if (savedSession) {
      this.sessionId = this.sessionId || savedSession.sessionId || null;
      this.seq = this.seq ?? savedSession.seq ?? null;
      this.resumeUrl = this.resumeUrl || savedSession.resumeUrl || null;
    }
    if (!this.env.DISCORD_BOT_TOKEN || !this.env.DISCORD_GUILD_ID) {
      this.lastError = "Missing DISCORD_BOT_TOKEN or DISCORD_GUILD_ID binding.";
      console.error("POSTLAIN Support Gateway configuration error:", this.lastError);
      return;
    }
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;

    try {
      const gatewayInfo = await fetch(`${DISCORD_API}/gateway/bot`, {
        headers: { Authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}` }
      });
      if (!gatewayInfo.ok) throw new Error(`Gateway discovery failed: HTTP ${gatewayInfo.status}`);
      const info = await gatewayInfo.json();
      const base = this.resumeUrl || info.url;
      const ws = new WebSocket(`${base}?v=10&encoding=json`);
      this.ws = ws;
      this.lastError = null;

      ws.addEventListener("open", () => console.log("Discord Gateway WebSocket transport opened."));
      ws.addEventListener("message", event => {
        let packet;
        try { packet = JSON.parse(event.data); } catch (error) {
          this.lastError = "Received an invalid JSON packet from Discord Gateway.";
          console.error(this.lastError);
          return;
        }
        this.lastGatewayPacketAt = new Date().toISOString();
        this.lastGatewayEvent = packet.t || ("OP_" + packet.op);
        this.ctx.waitUntil(this.handlePacket(packet).catch(error => {
          this.lastError = String(error?.message || error).slice(0, 300);
          console.error("Gateway packet error:", this.lastError, error?.stack || "");
        }));
      });
      ws.addEventListener("close", event => {
        this.clearHeartbeat();
        if (this.ws === ws) this.ws = null;
        if ([4007, 4009].includes(event.code)) {
          this.sessionId = null;
          this.seq = null;
          this.resumeUrl = null;
          this.persistSession();
        }
        this.isReady = false;
        this.lastCloseCode = event.code;
        this.lastCloseReason = String(event.reason || "").slice(0, 200);
        this.lastError = "Discord Gateway closed (" + event.code + "): " + (this.lastCloseReason || "no reason provided");
        console.warn("Discord Gateway closed:", event.code, event.reason);
        this.ctx.waitUntil(this.ctx.storage.setAlarm(Date.now() + 7000));
      });
      ws.addEventListener("error", error => {
        this.lastError = String(error?.message || "WebSocket transport error").slice(0, 300);
        console.error("Discord Gateway socket error:", this.lastError);
      });
      // Rotate before Cloudflare's 15-minute outbound-connection keepalive window.
      await this.ctx.storage.setAlarm(Date.now() + 13 * 60 * 1000);
    } catch (error) {
      this.lastError = String(error?.message || error).slice(0, 300);
      console.error("Could not connect Discord Gateway:", this.lastError, error?.stack || "");
      await this.ctx.storage.setAlarm(Date.now() + 15000);
    }
  }

  async handlePacket(packet) {
    if (packet.s !== undefined && packet.s !== null) {
      this.seq = packet.s;
      await this.persistSession();
    }
    if (packet.op === 10) {
      this.heartbeatInterval = packet.d.heartbeat_interval;
      this.startHeartbeat();
      if (this.sessionId && this.seq !== null) {
        this.send({
          op: 6,
          d: { token: this.env.DISCORD_BOT_TOKEN, session_id: this.sessionId, seq: this.seq }
        });
      } else {
        // GUILDS + GUILD_MESSAGES + MESSAGE_CONTENT. Application handling is restricted to the dedicated word-chain room.
        this.send({
          op: 2,
          d: {
            token: this.env.DISCORD_BOT_TOKEN,
            intents: 33281,
            properties: { os: "cloudflare-workers", browser: "postlain-community-assistant", device: "postlain-community-assistant" }
          }
        });
      }
      return;
    }
    if (packet.op === 1) {
      this.send({ op: 1, d: this.seq });
      return;
    }
    if (packet.op === 11) {
      this.awaitingAck = false;
      return;
    }
    if (packet.op === 7) {
      try { this.ws?.close(4000, "Discord requested reconnect"); } catch {}
      return;
    }
    if (packet.op === 9) {
      if (!packet.d) {
        this.sessionId = null;
        this.seq = null;
        this.resumeUrl = null;
        await this.persistSession();
      }
      try { this.ws?.close(4000, "Invalid Gateway session"); } catch {}
      await this.ctx.storage.setAlarm(Date.now() + 5000);
      return;
    }
    if (packet.op !== 0) return;

    if (packet.t === "READY") {
      this.isReady = true;
      this.readyAt = new Date().toISOString();
      this.sessionId = packet.d.session_id;
      this.resumeUrl = packet.d.resume_gateway_url;
      await this.persistSession();
      await this.refreshChannels();
      console.log("POSTLAIN Support Gateway READY.");
    } else if (packet.t === "RESUMED") {
      this.isReady = true;
      this.readyAt = new Date().toISOString();
      await this.refreshChannels();
      console.log("POSTLAIN Support Gateway session resumed.");
    } else if (packet.t === "MESSAGE_CREATE") {
      if (String(packet.d?.channel_id || "") === WORD_CHAIN_CHANNEL_ID) await this.handleWordChainMessage(packet.d);
    } else if (packet.t === "CHANNEL_CREATE" || packet.t === "CHANNEL_UPDATE" || packet.t === "THREAD_CREATE") {
      this.channelNames.set(packet.d.id, packet.d.name || "");
      if (packet.d.parent_id) this.channelParents.set(packet.d.id, packet.d.parent_id);
    }
  }

  startHeartbeat() {
    this.clearHeartbeat();
    const firstDelay = Math.floor(Math.random() * this.heartbeatInterval);
    this.heartbeatTimer = setTimeout(() => this.heartbeat(), firstDelay);
  }

  heartbeat() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.awaitingAck) {
      try { this.ws.close(4000, "Heartbeat ACK timeout"); } catch {}
      return;
    }
    this.awaitingAck = true;
    this.send({ op: 1, d: this.seq });
    this.heartbeatTimer = setTimeout(() => this.heartbeat(), this.heartbeatInterval);
  }

  clearHeartbeat() {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.awaitingAck = false;
  }

  send(payload) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload));
  }

  async persistSession() {
    await this.ctx.storage.put("gateway_session", {
      sessionId: this.sessionId,
      seq: this.seq,
      resumeUrl: this.resumeUrl,
      intents: 33281
    });
  }

  async refreshChannels() {
    try {
      const response = await fetch(`${DISCORD_API}/guilds/${this.env.DISCORD_GUILD_ID}/channels`, {
        headers: { Authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}` }
      });
      if (!response.ok) throw new Error(`Channel list HTTP ${response.status}`);
      const channels = await response.json();
      this.channelNames.clear();
      this.channelParents.clear();
      for (const channel of channels) {
        this.channelNames.set(channel.id, channel.name || "");
        if (channel.parent_id) this.channelParents.set(channel.id, channel.parent_id);
      }
      const activeThreads = await fetch(`${DISCORD_API}/guilds/${this.env.DISCORD_GUILD_ID}/threads/active`, {
        headers: { Authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}` }
      });
      if (activeThreads.ok) {
        const payload = await activeThreads.json();
        for (const thread of payload.threads || []) {
          this.channelNames.set(thread.id, thread.name || "");
          if (thread.parent_id) this.channelParents.set(thread.id, thread.parent_id);
        }
      }
    } catch (error) {
      console.error("Could not refresh Discord channel names:", error);
    }
  }

  async isExcluded(channelId, message = {}) {
    let channelName = this.channelNames.get(channelId) || "";
    let parentId = message.parent_id || this.channelParents.get(channelId) || null;
    let parentName = parentId ? (this.channelNames.get(parentId) || "") : "";

    // Channel cache can be empty after a Gateway resume or a missed CHANNEL_CREATE.
    // Resolve the channel directly before applying the privacy deny-list.
    if (!channelName) {
      try {
        const response = await fetch(`${DISCORD_API}/channels/${channelId}`, {
          headers: { Authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}` }
        });
        if (response.ok) {
          const channel = await response.json();
          channelName = channel.name || "";
          parentId = channel.parent_id || parentId;
          if (channelName) this.channelNames.set(channelId, channelName);
          if (parentId) this.channelParents.set(channelId, parentId);
          if (parentId && !parentName) {
            const parentResponse = await fetch(`${DISCORD_API}/channels/${parentId}`, {
              headers: { Authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}` }
            });
            if (parentResponse.ok) {
              const parent = await parentResponse.json();
              parentName = parent.name || "";
              if (parentName) this.channelNames.set(parentId, parentName);
            }
          }
        }
      } catch (error) {
        console.error("POSTLAIN Support could not resolve channel privacy:", String(error?.message || error));
      }
    }

    // Keep unknown channels fail-closed. Never process a channel whose privacy cannot be classified.
    if (!channelName) return true;
    return isExcludedChannel(channelId, parentId, channelName, parentName, this.env);
  }

  async deleteWordChainMessage(message, privateReason) {
    const channelId = String(message?.channel_id || "");
    const messageId = String(message?.id || "");
    const userId = String(message?.author?.id || "");
    if (!channelId || !messageId || !userId) return false;
    const deleted = await fetch(DISCORD_API + "/channels/" + channelId + "/messages/" + messageId, {
      method: "DELETE",
      headers: { Authorization: "Bot " + this.env.DISCORD_BOT_TOKEN }
    });
    if (!deleted.ok && deleted.status !== 404) {
      console.error("POSTLAIN could not delete off-game message:", deleted.status, (await deleted.text()).slice(0, 300));
      return false;
    }
    try {
      const dm = await fetch(DISCORD_API + "/users/@me/channels", {
        method: "POST",
        headers: { Authorization: "Bot " + this.env.DISCORD_BOT_TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify({ recipient_id: userId })
      });
      if (!dm.ok) {
        console.warn("POSTLAIN could not open private moderation DM:", dm.status);
        return true;
      }
      const dmChannel = await dm.json();
      const notice = await fetch(DISCORD_API + "/channels/" + dmChannel.id + "/messages", {
        method: "POST",
        headers: { Authorization: "Bot " + this.env.DISCORD_BOT_TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify({
          content: "🧹 Tin nhắn của bạn trong <#" + channelId + "> đã bị xóa. " + privateReason,
          allowed_mentions: { parse: [] }
        })
      });
      if (!notice.ok) console.warn("POSTLAIN private moderation notice failed:", notice.status, (await notice.text()).slice(0, 200));
    } catch (error) {
      console.warn("POSTLAIN private moderation notice error:", String(error?.message || error));
    }
    return true;
  }

  async sendWordChainMessage(channelId, content) {
    const response = await fetch(DISCORD_API + "/channels/" + channelId + "/messages", {
      method: "POST", headers: { Authorization: "Bot " + this.env.DISCORD_BOT_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } })
    });
    if (!response.ok) console.error("POSTLAIN word-chain reply failed:", response.status, (await response.text()).slice(0, 300));
  }

  normalizeChainPhrase(value) {
    return normalizeVietnamesePhrase(value);
  }

  async handleWordChainMessage(message) {
    const channelId = WORD_CHAIN_CHANNEL_ID;
    if (!message || String(message.guild_id || "") !== String(this.env.DISCORD_GUILD_ID || "")) return;
    if (String(message.channel_id || "") !== channelId || message.author?.bot || message.webhook_id) return;
    if (message.id) {
      const seen = this.ctx.storage.sql.exec("SELECT message_id FROM word_chain_processed_messages WHERE message_id = ?", String(message.id)).toArray()[0];
      if (seen) return;
      this.ctx.storage.sql.exec("INSERT OR IGNORE INTO word_chain_processed_messages (message_id, processed_at) VALUES (?, ?)", String(message.id), Date.now());
      this.ctx.storage.sql.exec("DELETE FROM word_chain_processed_messages WHERE processed_at < ?", Date.now() - 86400000);
    }
    const userId = String(message.author?.id || "");
    if (!userId) return;
    const hasNonTextPayload = Number(message.type || 0) !== 0
      || (message.attachments || []).length > 0
      || (message.embeds || []).length > 0
      || (message.sticker_items || []).length > 0
      || (message.components || []).length > 0
      || Boolean(message.application_id);
    if (hasNonTextPayload) {
      await this.deleteWordChainMessage(message, "Phòng này chỉ dành cho tin nhắn nối từ bằng chữ. Ảnh, sticker, file, embed và nội dung ngoài trò chơi không được phép.");
      return;
    }
    const commandText = String(message.content || "").trim().toLowerCase();
    if (commandText === "start!") {
      const current = this.ctx.storage.sql.exec("SELECT active FROM word_chain_games WHERE channel_id = ?", channelId).toArray()[0];
      if (current?.active) {
        await this.sendWordChainMessage(channelId, "Một ván nối từ đang diễn ra. Cứ gửi cụm 2 tiếng để tham gia nhé.");
        return;
      }
      this.ctx.storage.sql.exec(
        "INSERT OR REPLACE INTO word_chain_games (channel_id, active, starter_id, current_tail, used_words, last_player_id, moves, last_move_at) VALUES (?, 1, ?, NULL, '[]', NULL, 0, ?)",
        channelId, userId, Date.now()
      );
      await this.sendWordChainMessage(channelId, "🎮 **Nối từ đã sẵn sàng!** Gửi cụm tiếng Việt gồm 2 tiếng để đi lượt đầu tiên. Dùng `stop!` để kết thúc ván.");
      return;
    }
    if (commandText === "stop!") {
      const current = this.ctx.storage.sql.exec("SELECT active, starter_id FROM word_chain_games WHERE channel_id = ?", channelId).toArray()[0];
      if (!current?.active) {
        await this.sendWordChainMessage(channelId, "Hiện chưa có ván nối từ nào.");
        return;
      }
      const permissions = BigInt(message.member?.permissions || "0");
      const isAdmin = (permissions & 8n) === 8n;
      if (String(current.starter_id) !== userId && !isAdmin) {
        await this.deleteWordChainMessage(message, "Chỉ người mở ván hoặc Admin mới có thể dùng `stop!`.");
        return;
      }
      this.ctx.storage.sql.exec("UPDATE word_chain_games SET active = 0 WHERE channel_id = ?", channelId);
      await this.sendWordChainMessage(channelId, "Ván nối từ đã kết thúc. Gõ `start!` để mở ván mới.");
      return;
    }
    const parsed = parseTwoSyllablePhrase(message.content);
    if (!parsed.ok) {
      await this.deleteWordChainMessage(message, "Mỗi lượt phải là đúng **2 tiếng tiếng Việt**, chỉ gồm chữ và một dấu cách. Ví dụ: **con gà**.");
      return;
    }
    const custom = this.ctx.storage.sql.exec("SELECT phrase FROM word_chain_custom_words WHERE phrase = ?", parsed.phrase).toArray().length > 0;
    const checked = validateDictionaryPhrase(parsed.phrase, WORD_CHAIN_DICTIONARY, custom ? new Set([parsed.phrase]) : new Set());
    if (!checked.ok) {
      await this.deleteWordChainMessage(message, "Cụm **" + parsed.phrase + "** chưa được xác nhận trong từ điển. Nếu đây là cụm tiếng Việt có thật, Admin có thể bổ sung bằng lệnh **/them-tu**.");
      return;
    }
    const now = Date.now();
    const row = this.ctx.storage.sql.exec("SELECT * FROM word_chain_games WHERE channel_id = ? AND active = 1", channelId).toArray()[0];
    if (!row) {
      this.ctx.storage.sql.exec("INSERT OR REPLACE INTO word_chain_games (channel_id, active, starter_id, current_tail, used_words, last_player_id, moves, last_move_at) VALUES (?, 1, ?, ?, ?, ?, 1, ?)", channelId, userId, parsed.last, JSON.stringify([parsed.phrase]), userId, now);
      this.ctx.storage.sql.exec("INSERT INTO word_chain_scores (user_id, wins, losses, moves) VALUES (?, 0, 0, 1) ON CONFLICT(user_id) DO UPDATE SET moves = moves + 1", userId);
      await this.ctx.storage.setAlarm(now + WORD_CHAIN_TURN_MS);
      await this.sendWordChainMessage(channelId, "🎮 **POSTLAIN NỐI TỪ đã bắt đầu!**\n✅ **" + parsed.phrase + "**\n🔗 Người tiếp theo nối bằng tiếng: **" + parsed.last + "**\n⏱️ 30 giây mỗi lượt.");
      return;
    }
    const used = (() => { try { return JSON.parse(row.used_words || "[]"); } catch { return []; } })();
    if (!row.current_tail) {
      this.ctx.storage.sql.exec("UPDATE word_chain_games SET current_tail = ?, used_words = ?, last_player_id = ?, moves = 1, last_move_at = ? WHERE channel_id = ? AND active = 1", parsed.last, JSON.stringify([parsed.phrase]), userId, now, channelId);
      this.ctx.storage.sql.exec("INSERT INTO word_chain_scores (user_id, wins, losses, moves) VALUES (?, 0, 0, 1) ON CONFLICT(user_id) DO UPDATE SET moves = moves + 1", userId);
      await this.ctx.storage.setAlarm(now + WORD_CHAIN_TURN_MS);
      await this.sendWordChainMessage(channelId, "✅ **" + parsed.phrase + "**\n🔗 Tiếng tiếp theo: **" + parsed.last + "**\n⏱️ 30 giây mỗi lượt.");
      return;
    }
    const previousPlayer = String(row.last_player_id || "");
    const previousTail = String(row.current_tail || "");
    if (previousTail && row.last_move_at && now - Number(row.last_move_at) >= WORD_CHAIN_TURN_MS) {
      this.ctx.storage.sql.exec("UPDATE word_chain_games SET active = 0 WHERE channel_id = ?", channelId);
      if (previousPlayer) this.ctx.storage.sql.exec("INSERT INTO word_chain_scores (user_id, wins, losses, moves) VALUES (?, 1, 0, 0) ON CONFLICT(user_id) DO UPDATE SET wins = wins + 1", previousPlayer);
      await this.sendWordChainMessage(channelId, "⏰ Hết giờ! <@" + previousPlayer + "> thắng ván trước. Cụm hợp lệ này mở ván mới.");
      this.ctx.storage.sql.exec("INSERT OR REPLACE INTO word_chain_games (channel_id, active, starter_id, current_tail, used_words, last_player_id, moves, last_move_at) VALUES (?, 1, ?, ?, ?, ?, 1, ?)", channelId, userId, parsed.last, JSON.stringify([parsed.phrase]), userId, now);
      this.ctx.storage.sql.exec("INSERT INTO word_chain_scores (user_id, wins, losses, moves) VALUES (?, 0, 0, 1) ON CONFLICT(user_id) DO UPDATE SET moves = moves + 1", userId);
      await this.ctx.storage.setAlarm(now + WORD_CHAIN_TURN_MS);
      await this.sendWordChainMessage(channelId, "🎮 **Ván mới!** ✅ **" + parsed.phrase + "**\n🔗 Nối bằng tiếng: **" + parsed.last + "**");
      return;
    }
    const move = validateChainMove({ parsed, currentTail: previousTail, usedWords: used, lastPlayerId: previousPlayer, userId });
    if (move.code === "same_player") {
      await this.deleteWordChainMessage(message, "Bạn vừa đi lượt trước. Hãy chờ một người khác nối từ rồi mới gửi lượt tiếp theo.");
      return;
    }
    const loseRound = async reason => {
      this.ctx.storage.sql.exec("UPDATE word_chain_games SET active = 0 WHERE channel_id = ?", channelId);
      if (previousPlayer && previousPlayer !== userId) this.ctx.storage.sql.exec("INSERT INTO word_chain_scores (user_id, wins, losses, moves) VALUES (?, 1, 0, 0) ON CONFLICT(user_id) DO UPDATE SET wins = wins + 1", previousPlayer);
      this.ctx.storage.sql.exec("INSERT INTO word_chain_scores (user_id, wins, losses, moves) VALUES (?, 0, 1, 0) ON CONFLICT(user_id) DO UPDATE SET losses = losses + 1", userId);
      await this.sendWordChainMessage(channelId, "❌ <@" + userId + "> " + reason + (previousPlayer && previousPlayer !== userId ? "\n🏆 <@" + previousPlayer + "> thắng ván này!" : "") + "\nCụm hợp lệ tiếp theo sẽ tự mở ván mới.");
    };
    if (move.code === "repeated") { await loseRound("đã dùng cụm **" + parsed.phrase + "** rồi. Trùng từ, thua ván!"); return; }
    if (move.code === "wrong_chain") { await loseRound("nối sai! Phải bắt đầu bằng tiếng **" + move.expected + "**."); return; }
    used.push(parsed.phrase);
    this.ctx.storage.sql.exec("UPDATE word_chain_games SET current_tail = ?, used_words = ?, last_player_id = ?, moves = moves + 1, last_move_at = ? WHERE channel_id = ? AND active = 1", move.nextTail, JSON.stringify(used), userId, now, channelId);
    this.ctx.storage.sql.exec("INSERT INTO word_chain_scores (user_id, wins, losses, moves) VALUES (?, 0, 0, 1) ON CONFLICT(user_id) DO UPDATE SET moves = moves + 1", userId);
    await this.ctx.storage.setAlarm(now + WORD_CHAIN_TURN_MS);
    await this.sendWordChainMessage(channelId, "✅ **" + parsed.phrase + "**\n🔗 Tiếng tiếp theo: **" + move.nextTail + "**");
  }

  async handleMessage(message) {
    const guildId = String(this.env.DISCORD_GUILD_ID || "");
    if (!message || String(message.guild_id || "") !== guildId) return;
    if (!message.channel_id || message.author?.bot || message.webhook_id) return;
    const content = String(message.content || "").trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!content || await this.isExcluded(message.channel_id, message)) return;

    const authorId = String(message.author?.id || "");
    if (!authorId) return;
    const normalized = content.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase();
    const session = this.getSupportSession(message.channel_id, authorId);

    if (session && /\b(staff|moderator|moderators|mod|admin|human)\b/.test(normalized)) {
      if (!this.canSendProactive(message.channel_id, authorId, Date.now(), true)) return;
      let escalationMessage = message;
      if (session.sourceMessageId) {
        try {
          const originalResponse = await fetch(DISCORD_API + "/channels/" + message.channel_id + "/messages/" + session.sourceMessageId, { headers: { Authorization: "Bot " + this.env.DISCORD_BOT_TOKEN } });
          if (originalResponse.ok) {
            const original = await originalResponse.json();
            escalationMessage = { ...message, id: original.id, content: "Original request: " + String(original.content || "").slice(0, 700) + "\nMember follow-up: " + content.slice(0, 180) };
          }
        } catch (error) {
          console.warn("Could not fetch original support message for escalation:", String(error?.message || error));
        }
      }
      const notified = await this.notifyStaff(escalationMessage, session.category, "member-requested-human");
      const reply = notified
        ? "📨 Mình đã chuyển yêu cầu đến Staff. Hãy chờ đội ngũ phản hồi. Đừng gửi mật khẩu hoặc mã xác thực."
        : "⚠️ Chưa chuyển được yêu cầu tự động. Bạn hãy liên hệ Moderator trực tiếp trong server nhé.";
      await this.replyWithSupport(message, reply);
      this.clearSupportSession(message.channel_id, authorId);
      return;
    }

    if (session && /^(thanks|thank you|thx|tks|ty|ok|okay|got it|cam on|da duoc|ok roi|resolved|done|fixed|solved)$/.test(normalized)) {
      this.clearSupportSession(message.channel_id, authorId);
      return;
    }

    const support = classifySupportMessage(content);
    if (!support) return;
    if (!this.canSendProactive(message.channel_id, authorId)) return;

    console.log("POSTLAIN support topic detected", { category: support.key, channelId: message.channel_id, messageId: message.id });
    const suggestedChannel = this.findSuggestedChannel(support.key);
    const replyParts = [support.response, support.followUp];
    if (suggestedChannel) replyParts.push("🔎 Relevant room: <#" + suggestedChannel + ">");
    const reply = replyParts.filter(Boolean).join("\n\n");
    const sent = await this.replyWithSupport(message, reply);
    if (sent) this.saveSupportSession(message.channel_id, authorId, support.key, message.id);
    if (support.requiresStaff) await this.notifyStaff(message, support.key, "automatic-safety-escalation");
  }

  getSupportSession(channelId, authorId) {
    const now = Date.now();
    const row = this.ctx.storage.sql.exec(
      "SELECT category, source_message_id, created_at FROM support_sessions WHERE channel_id = ? AND author_id = ?",
      channelId, authorId
    ).toArray()[0];
    if (!row) return null;
    if (now - Number(row.created_at) > 15 * 60 * 1000) {
      this.clearSupportSession(channelId, authorId);
      return null;
    }
    return { category: row.category, sourceMessageId: row.source_message_id };
  }

  saveSupportSession(channelId, authorId, category, sourceMessageId) {
    const now = Date.now();
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO support_sessions (channel_id, author_id, category, source_message_id, created_at) VALUES (?, ?, ?, ?, ?)",
      channelId, authorId, category, sourceMessageId, now
    );
    this.ctx.storage.sql.exec("DELETE FROM support_sessions WHERE created_at < ?", now - 24 * 60 * 60 * 1000);
  }

  clearSupportSession(channelId, authorId) {
    this.ctx.storage.sql.exec(
      "DELETE FROM support_sessions WHERE channel_id = ? AND author_id = ?",
      channelId, authorId
    );
  }

  findSuggestedChannel(category) {
    const hints = {
      "state-role": ["state-selector", "state-roles", "choose-state", "state-role"],
      "verification-access": ["verification", "verify", "start-here", "onboarding"],
      "feedback": ["feedback", "suggestions"],
      "server-rules": ["rules", "server-rules"],
      "events-community": ["events", "announcements"],
      "music-playback": ["music", "listening", "playlists"],
      "voice-audio": ["voice", "audio", "voice-chat"]
    }[category] || [];
    if (!hints.length) return null;
    for (const [channelId, channelName] of this.channelNames.entries()) {
      const name = String(channelName || "").toLowerCase();
      if (hints.some(hint => name.includes(hint))) return channelId;
    }
    return null;
  }

  canSendProactive(channelId, authorId, now = Date.now(), isFollowUp = false) {
    const globalCount = this.ctx.storage.sql.exec("SELECT COUNT(*) AS count FROM proactive_replies WHERE created_at > ?", now - 60 * 60 * 1000).toArray()[0]?.count || 0;
    if (globalCount >= 8) return false;
    if (isFollowUp) return true;
    const channelRecent = this.ctx.storage.sql.exec("SELECT COUNT(*) AS count FROM proactive_replies WHERE channel_id = ? AND created_at > ?", channelId, now - 60 * 1000).toArray()[0]?.count || 0;
    if (channelRecent > 0) return false;
    const authorRecent = this.ctx.storage.sql.exec("SELECT COUNT(*) AS count FROM proactive_replies WHERE author_id = ? AND created_at > ?", authorId, now - 2 * 60 * 1000).toArray()[0]?.count || 0;
    return authorRecent === 0;
  }

  async replyWithSupport(message, responseText) {
    const authorId = String(message.author?.id || "");
    if (!authorId) return;
    const response = await fetch(DISCORD_API + "/channels/" + message.channel_id + "/messages", {
      method: "POST",
      headers: { Authorization: "Bot " + this.env.DISCORD_BOT_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({
        content: responseText,
        message_reference: { message_id: message.id, fail_if_not_exists: false },
        allowed_mentions: { parse: [] }
      })
    });
    if (!response.ok) {
      console.error("POSTLAIN support reply failed:", response.status, (await response.text()).slice(0, 300));
      return false;
    }
    const now = Date.now();
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO proactive_replies (id, channel_id, author_id, created_at) VALUES (?, ?, ?, ?)", message.id, message.channel_id, authorId, now);
    this.ctx.storage.sql.exec("DELETE FROM proactive_replies WHERE created_at < ?", now - 24 * 60 * 60 * 1000);
    console.log("POSTLAIN support reply sent", { channelId: message.channel_id, messageId: message.id });
    return true;
  }

  async notifyStaff(message, category, escalationType = "automatic-safety-escalation") {
    const staffChannelId = String(this.env.SUPPORT_STAFF_CHANNEL_ID || "");
    const authorId = String(message.author?.id || "");
    if (!staffChannelId || !authorId) return false;
    const excerpt = String(message.content || "").trim().slice(0, 900) || "(no text content)";
    const jumpUrl = "https://discord.com/channels/" + this.env.DISCORD_GUILD_ID + "/" + message.channel_id + "/" + message.id;
    try {
      const response = await fetch(DISCORD_API + "/channels/" + staffChannelId + "/messages", {
        method: "POST",
        headers: { Authorization: "Bot " + this.env.DISCORD_BOT_TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify({
          embeds: [{
            color: 0xE05D5D,
            title: escalationType === "member-requested-human" ? "🙋 HUMAN SUPPORT REQUEST" : "🛡️ COMMUNITY SUPPORT ESCALATION",
            description: escalationType === "member-requested-human" ? "A member asked for direct human support." : "A member submitted a safety report that needs Staff review.",
            fields: [
              { name: "Category", value: String(category), inline: true },
              { name: "Member", value: "<@" + authorId + ">  ·  " + authorId, inline: true },
              { name: "Channel", value: "<#" + message.channel_id + ">", inline: true },
              { name: "Message", value: excerpt, inline: false },
              { name: "Open original", value: "[Jump to message](" + jumpUrl + ")", inline: false }
            ],
            timestamp: new Date().toISOString(),
            footer: { text: "POSTLAIN Community Assistant" }
          }],
          allowed_mentions: { parse: [] }
        })
      });
      if (!response.ok) {
        console.error("POSTLAIN Staff escalation failed:", response.status, (await response.text()).slice(0, 300));
        return false;
      }
      console.log("POSTLAIN safety report routed to Staff", { channelId: message.channel_id, messageId: message.id });
      return true;
    } catch (error) {
      console.error("POSTLAIN Staff escalation error:", String(error?.message || error));
      return false;
    }
  }

}
