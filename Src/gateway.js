const DISCORD_API = "https://discord.com/api/v10";
const DEFAULT_EXCLUDED_CHANNELS = new Set([
  "1571762668916707399", // Staff chat
  "1571762812886192178"  // Mod logs
]);
const PRIVATE_NAME = /(^|[-_ ])(staff|admin|moderation|modlog|mod-logs|ticket|private|internal)([-_ ]|$)/i;
const MAX_MESSAGE_LENGTH = 1800;

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
    return new Response("Not found", { status: 404 });
  }

  async alarm() {
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
    if (savedSession) {
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
        // GUILDS + GUILD_MESSAGES + MESSAGE_CONTENT.
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
    } else if (packet.t === "CHANNEL_CREATE" || packet.t === "CHANNEL_UPDATE" || packet.t === "THREAD_CREATE") {
      this.channelNames.set(packet.d.id, packet.d.name || "");
      if (packet.d.parent_id) this.channelParents.set(packet.d.id, packet.d.parent_id);
    } else if (packet.t === "MESSAGE_CREATE") {
      await this.handleMessage(packet.d);
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
      resumeUrl: this.resumeUrl
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
            escalationMessage = { ...message, id: original.id, content: "Original request: " + String(original.content || "").slice(0, 700) + "\\nMember follow-up: " + content.slice(0, 180) };
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
