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
      return Response.json({ ok: true, state: this.ws?.readyState === WebSocket.OPEN ? "connected" : "connecting" });
    }
    if (url.pathname === "/status") {
      const count = this.ctx.storage.sql.exec("SELECT COUNT(*) AS count FROM community_messages").toArray()[0]?.count || 0;
      return Response.json({
        ok: true,
        state: this.ws?.readyState === WebSocket.OPEN ? "connected" : "disconnected",
        storedMessages: count,
        guildId: this.env.DISCORD_GUILD_ID
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
      console.error("Gateway missing DISCORD_BOT_TOKEN or DISCORD_GUILD_ID.");
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

      ws.addEventListener("message", event => {
        let packet;
        try { packet = JSON.parse(event.data); } catch { return; }
        this.handlePacket(packet).catch(error => console.error("Gateway packet error:", error));
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
        console.warn("Discord Gateway closed:", event.code, event.reason);
        this.ctx.storage.setAlarm(Date.now() + 7000);
      });
      ws.addEventListener("error", error => console.error("Discord Gateway socket error:", error));
      // Rotate before Cloudflare's 15-minute outbound-connection keepalive window.
      await this.ctx.storage.setAlarm(Date.now() + 13 * 60 * 1000);
    } catch (error) {
      console.error("Could not connect Discord Gateway:", error);
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
      // Welcome automation is intentionally deferred until a public welcome channel is configured.
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

  isExcluded(channelId, message = {}) {
    const parentId = message.parent_id || this.channelParents.get(channelId) || null;
    const parentName = parentId ? this.channelNames.get(parentId) : "";
    const channelName = this.channelNames.get(channelId) || "";
    if (!channelName) return true; // Unknown channels are denied until their privacy classification is known.
    return isExcludedChannel(channelId, parentId, channelName, parentName, this.env);
  }

  async handleMessage(message) {
    const guildId = this.env.DISCORD_GUILD_ID;
    if (!shouldStoreMessage(message, guildId, (channelId, msg) => this.isExcluded(channelId, msg))) return;

    const content = String(message.content || "").trim().slice(0, MAX_MESSAGE_LENGTH);
    const channelName = this.channelNames.get(message.channel_id) || "community";
    const authorName = message.member?.nick || message.author?.global_name || message.author?.username || "Member";
    const createdAt = Date.parse(message.timestamp || new Date().toISOString());
    this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO community_messages (id, channel_id, channel_name, author_name, content, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      message.id, message.channel_id, channelName, authorName.slice(0, 80), content, createdAt
    );
    this.ctx.storage.sql.exec("DELETE FROM community_messages WHERE created_at < ?", Date.now() - RETENTION_MS);
    this.ctx.storage.sql.exec("DELETE FROM community_messages WHERE id IN (SELECT id FROM community_messages ORDER BY created_at DESC LIMIT -1 OFFSET 1500)");

    const botId = this.env.DISCORD_APPLICATION_ID;
    const mentioned = Array.isArray(message.mentions) && message.mentions.some(user => user.id === botId);
    if (mentioned && botId && content) await this.replyToMention(message, content);
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
    if (!userId || now - (this.lastMentionReplyAt.get(userId) || 0) < 15000) return;
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
      console.error("POSTLAIN AI mention handler failed:", error);
    }
  }
}
