import { generateAnswer } from "./ai/engine.js";

const DISCORD_API = "https://discord.com/api/v10";
const DEFAULT_EXCLUDED_CHANNELS = new Set([
  "1571762668916707399", // Staff chat
  "1571762812886192178"  // Mod logs
]);
const PRIVATE_NAME = /(^|[-_ ])(staff|admin|moderation|modlog|mod-logs|ticket|private|internal)([-_ ]|$)/i;
const MAX_MESSAGE_LENGTH = 1800;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function parseIds(value) {
  return String(value || "").split(",").map(x => x.trim()).filter(Boolean);
}

export function isExcludedChannel(channelId, parentId, channelName, parentName, env = {}) {
  const excluded = new Set([
    ...DEFAULT_EXCLUDED_CHANNELS,
    ...parseIds(env.AI_EXCLUDED_CHANNEL_IDS),
    env.KNOWLEDGE_CHANNEL_ID
  ].filter(Boolean));
  if (excluded.has(String(channelId)) || (parentId && excluded.has(String(parentId)))) return true;
  if (PRIVATE_NAME.test(String(channelName || "")) || PRIVATE_NAME.test(String(parentName || ""))) return true;
  return false;
}

export function shouldStoreMessage(message, guildId, excluded) {
  if (!message || message.guild_id !== guildId) return false;
  if (!message.channel_id || excluded(message.channel_id, message)) return false;
  if (message.author?.bot || message.webhook_id) return false;
  if (message.type !== undefined && message.type !== 0 && message.type !== 19 && message.type !== 21) return false;
  return Boolean(String(message.content || "").trim());
}

function splitMessage(value, max = 1900) {
  let text = String(value || "").trim();
  const chunks = [];
  while (text.length > max) {
    let cut = text.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = text.lastIndexOf(" ", max);
    if (cut < max * 0.5) cut = max;
    chunks.push(text.slice(0, cut).trim());
    text = text.slice(cut).trimStart();
  }
  if (text) chunks.push(text);
  return chunks;
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
    this.channelNames = new Map();
    this.channelParents = new Map();
    this.lastMentionReplyAt = new Map();
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS community_messages (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        channel_name TEXT NOT NULL,
        author_name TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    this.ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS idx_community_messages_time ON community_messages(created_at)");
    this.ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS idx_community_messages_channel ON community_messages(channel_id, created_at)");
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
      const count = this.ctx.storage.sql.exec("SELECT COUNT(*) AS count FROM community_messages").toArray()[0]?.count || 0;
      const socketState = this.ws?.readyState;
      const state = socketState === WebSocket.OPEN ? "connected" : socketState === WebSocket.CONNECTING ? "connecting" : "disconnected";
      return Response.json({
        ok: true,
        state,
        socketReadyState: socketState ?? null,
        storedMessages: count,
        guildId: this.env.DISCORD_GUILD_ID,
        lastError: this.lastError,
        lastGatewayPacketAt: this.lastGatewayPacketAt,
        lastGatewayEvent: this.lastGatewayEvent,
        lastCloseCode: this.lastCloseCode,
        lastCloseReason: this.lastCloseReason,
        hasBotToken: Boolean(this.env.DISCORD_BOT_TOKEN)
      });
    }
    if (url.pathname === "/context") {
      const channelId = url.searchParams.get("channel_id") || "";
      return Response.json({ context: this.getContext(channelId) });
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
      console.error("POSTLAIN AI Gateway configuration error:", this.lastError);
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
        // GUILDS + GUILD_MEMBERS + GUILD_MESSAGES + MESSAGE_CONTENT.
        this.send({
          op: 2,
          d: {
            token: this.env.DISCORD_BOT_TOKEN,
            intents: 33283,
            properties: { os: "cloudflare-workers", browser: "postlain-ai", device: "postlain-ai" }
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
      this.sessionId = packet.d.session_id;
      this.resumeUrl = packet.d.resume_gateway_url;
      await this.persistSession();
      await this.refreshChannels();
      console.log("POSTLAIN AI Gateway READY.");
    } else if (packet.t === "RESUMED") {
      await this.refreshChannels();
      console.log("POSTLAIN AI Gateway session resumed.");
    } else if (packet.t === "CHANNEL_CREATE" || packet.t === "CHANNEL_UPDATE" || packet.t === "THREAD_CREATE") {
      this.channelNames.set(packet.d.id, packet.d.name || "");
      if (packet.d.parent_id) this.channelParents.set(packet.d.id, packet.d.parent_id);
    } else if (packet.t === "MESSAGE_CREATE") {
      await this.handleMessage(packet.d);
    } else if (packet.t === "GUILD_MEMBER_ADD") {
      await this.sendWelcome(packet.d);
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
        console.error("POSTLAIN AI could not resolve channel privacy:", String(error?.message || error));
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
    if (!content) return;
    if (await this.isExcluded(message.channel_id, message)) return;

    const botId = String(this.env.DISCORD_BOT_USER_ID || "");
    const mentionInPayload = Array.isArray(message.mentions) &&
      message.mentions.some(user => String(user.id) === botId);
    const mentionInContent = botId
      ? (content.includes(`<@${botId}>`) || content.includes(`<@!${botId}>`))
      : false;
    const mentioned = Boolean(botId && (mentionInPayload || mentionInContent));

    const channelName = this.channelNames.get(message.channel_id) || "community";
    const authorName = message.member?.nick || message.author?.global_name || message.author?.username || "Member";
    const createdAt = Date.parse(message.timestamp || new Date().toISOString());
    this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO community_messages (id, channel_id, channel_name, author_name, content, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      message.id, message.channel_id, channelName, authorName.slice(0, 80), content, createdAt
    );
    this.ctx.storage.sql.exec("DELETE FROM community_messages WHERE created_at < ?", Date.now() - RETENTION_MS);
    this.ctx.storage.sql.exec("DELETE FROM community_messages WHERE id IN (SELECT id FROM community_messages ORDER BY created_at DESC LIMIT -1 OFFSET 1500)");

    if (mentioned) {
      console.log("POSTLAIN AI mention detected", {
        channelId: message.channel_id,
        authorId: message.author?.id,
        botId,
        mentionInPayload,
        mentionInContent
      });
      await this.replyToMention(message, content);
    }
  }
  async sendWelcome(memberData = {}) {
    const user = memberData.user || memberData;
    const userId = String(user.id || "");
    if (!userId) return;

    let welcomeChannelId = String(this.env.WELCOME_CHANNEL_ID || "").trim();
    if (!welcomeChannelId) {
      const candidates = [...this.channelNames.entries()];
      const match = candidates.find(([, name]) =>
        /^(welcome|welcome-room|welcome-here|new-members|introductions|chao-mung|chao-don|gioi-thieu|phong-chao-mung)$/i.test(String(name || "").replace(/[^a-z0-9-]/gi, ""))
      );
      welcomeChannelId = match?.[0] || "";
    }

    if (!welcomeChannelId) {
      console.warn("POSTLAIN AI welcome skipped: set WELCOME_CHANNEL_ID or create a clearly named public welcome channel.");
      return;
    }

    const displayName = String(user.global_name || user.username || "bạn mới").slice(0, 80);
    const payload = {
      content: `Chào mừng <@${userId}> đến với **POSTLAIN**! 🎉\\n\\nTụi mình rất vui vì có mày ở đây. Cứ giới thiệu đôi chút về bản thân, khám phá các phòng chat và thoải mái tham gia cùng mọi người nhé. Nếu cần hỗ trợ, cứ gọi POSTLAIN AI bằng cách tag tao.\\n\\nChúc mày có khoảng thời gian thật vui ở đây! 🖤`,
      allowed_mentions: { users: [userId] }
    };

    try {
      const response = await fetch(`${DISCORD_API}/channels/${welcomeChannelId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        console.error("POSTLAIN AI welcome failed:", response.status, (await response.text()).slice(0, 400));
        return;
      }
      console.log("POSTLAIN AI welcomed new member", { userId, welcomeChannelId, displayName });
    } catch (error) {
      console.error("POSTLAIN AI welcome delivery failed:", String(error?.message || error));
    }
  }

  getContext(channelId = "") {
    const channelRows = channelId
      ? this.ctx.storage.sql.exec(
          "SELECT channel_name, author_name, content, created_at FROM community_messages WHERE channel_id = ? ORDER BY created_at DESC LIMIT 18",
          channelId
        ).toArray().reverse()
      : [];
    const serverRows = this.ctx.storage.sql.exec(
      "SELECT channel_name, author_name, content, created_at FROM community_messages ORDER BY created_at DESC LIMIT 12"
    ).toArray().reverse();
    const seen = new Set();
    const rows = [...channelRows, ...serverRows].filter(row => {
      const key = row.created_at + "|" + row.author_name + "|" + row.content;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(-28);
    return rows.map(row => `[#${row.channel_name}] ${row.author_name}: ${row.content}`).join("\n").slice(-10000);
  }

  async loadKnowledge() {
    if (!this.env.KNOWLEDGE_CHANNEL_ID) return "";
    try {
      const response = await fetch(`${DISCORD_API}/channels/${this.env.KNOWLEDGE_CHANNEL_ID}/messages?limit=100`, {
        headers: { Authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}` }
      });
      if (!response.ok) return "";
      const messages = await response.json();
      return messages.filter(m => m.author?.id === this.env.DISCORD_APPLICATION_ID && m.embeds?.[0]?.title === "POSTLAIN KNOWLEDGE")
        .slice(0, 10).reverse()
        .map((m, i) => `${i + 1}. [${m.embeds[0].fields?.find(f => f.name === "Topic")?.value || "General"}] ${m.embeds[0].description || ""}`)
        .join("\n").slice(0, 10000);
    } catch (error) {
      console.error("Could not load curated knowledge:", error);
      return "";
    }
  }

  async replyToMention(message, rawContent) {
    const userId = message.author?.id;
    const now = Date.now();
    if (!userId) return;
    const lastReplyAt = this.lastMentionReplyAt.get(userId) || 0;
    if (now - lastReplyAt < 5000) {
      const waitResponse = await fetch(`${DISCORD_API}/channels/${message.channel_id}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          content: "Tao đang xử lý tin nhắn vừa rồi. Chờ tao vài giây rồi hỏi tiếp nhé!",
          message_reference: { message_id: message.id, fail_if_not_exists: false },
          allowed_mentions: { parse: [] }
        })
      });
      if (!waitResponse.ok) {
        console.error("POSTLAIN AI cooldown notice failed:", waitResponse.status, (await waitResponse.text()).slice(0, 300));
      }
      return;
    }
    this.lastMentionReplyAt.set(userId, now);
    const question = rawContent.replace(/<@!?\d+>/g, "").trim();
    if (!question) return;

    try {
      const knowledge = await this.loadKnowledge();
      const context = this.getContext(message.channel_id);
      const answer = await generateAnswer(this.env, question, knowledge, context);
      for (const chunk of splitMessage(answer)) {
        const response = await fetch(`${DISCORD_API}/channels/${message.channel_id}/messages`, {
          method: "POST",
          headers: {
            Authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            content: chunk,
            message_reference: { message_id: message.id, fail_if_not_exists: false },
            allowed_mentions: { parse: [] }
          })
        });
        if (!response.ok) {
          console.error("POSTLAIN AI mention reply failed:", response.status, (await response.text()).slice(0, 300));
          break;
        }
      }
    } catch (error) {
      console.error("POSTLAIN AI mention handler failed:", String(error?.message || error), error?.stack || "");
      try {
        const fallback = await fetch(`${DISCORD_API}/channels/${message.channel_id}/messages`, {
          method: "POST",
          headers: {
            Authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            content: `Tao đang bị lỗi AI thật rồi 😵‍💫\n\`${String(error?.message || "Unknown AI error").slice(0, 850)}\``,
            message_reference: { message_id: message.id, fail_if_not_exists: false },
            allowed_mentions: { parse: [] }
          })
        });
        if (!fallback.ok) {
          console.error("POSTLAIN AI fallback reply failed:", fallback.status, (await fallback.text()).slice(0, 300));
        }
      } catch (fallbackError) {
        console.error("POSTLAIN AI fallback delivery failed:", String(fallbackError?.message || fallbackError));
      }
    }
  }
}
