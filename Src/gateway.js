const DISCORD_API = "https://discord.com/api/v10";
const DEFAULT_EXCLUDED_CHANNELS = new Set([
  "1571762668916707399", // Staff chat
  "1571762812886192178"  // Mod logs
]);
const PRIVATE_NAME = /(^|[-_ ])(staff|admin|moderation|modlog|mod-logs|ticket|private|internal)([-_ ]|$)/i;
const MAX_MESSAGE_LENGTH = 1800;

function normalizeSupportText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
export function classifySupportMessage(content) {
  const raw = String(content || "").trim();
  if (raw.length < 3 || raw.length > MAX_MESSAGE_LENGTH) return null;
  const text = normalizeSupportText(raw);
  const asks = /\b(cho minh hoi|cho hoi|cho tui hoi|giup minh|giup voi|can giup|minh can|can hoi|help|need help|anyone know|co ai biet|ai biet khong|hoi chut|hoi xiu|report|bao cao|co van de|loi|error|bug|khong duoc|khong hoat dong|khong thay|o dau|lam sao|the nao|cach nao|tai sao|vi sao|sao lai|huong dan|support|ho tro)\b/.test(text);
  if (!asks) return null;
  if (/(bang|state|tieu bang|chon bang|doi bang|role bang|state role)/.test(text)) return { key: "state-role", response: "🗺️ **Vụ chọn bang / State Role**\nMở phòng có bảng chọn bang của server, bấm danh sách và chọn bang mày đang sống. Bot sẽ tự cập nhật role, bang cũ được thay thế. Nếu bảng không hiện, chọn không được hoặc role không đổi, gửi ảnh màn hình kèm tên bang để staff kiểm tra nhé." };
  if (/(verify|verification|xac minh|xac thuc|duyet thanh vien|cap role|nhan role|role member|vai tro|quyen truy cap|khong vao duoc kenh)/.test(text)) return { key: "verification-role", response: "🔐 **Vấn đề xác minh / nhận role**\nKiểm tra phòng hướng dẫn xác minh và làm đúng bước được ghim ở đó. Nếu đã xác minh mà vẫn không thấy phòng hoặc chưa có role, gửi ảnh màn hình và nói rõ bước bị kẹt để staff kiểm tra quyền nhé. Đừng gửi mật khẩu hay mã đăng nhập." };
  if (/(discord|tai khoan|dang nhap|mat khau|ma xac minh|nitro|ung dung|app|dien thoai|may tinh)/.test(text)) return { key: "discord-account", response: "🛠️ **Sự cố Discord / tài khoản**\nThử cập nhật Discord, đóng mở lại ứng dụng và kiểm tra kết nối. Nếu vẫn lỗi, gửi ảnh hoặc nguyên văn thông báo lỗi, cho biết đang dùng Android, iPhone hay máy tính. Nhớ che email, số điện thoại và thông tin riêng tư." };
  if (/(nhac|music|audio|voice|giong|mic|micro|tai nghe|loa|phat nhac|nghe nhac)/.test(text)) return { key: "music-audio", response: "🎧 **Hỗ trợ âm thanh / âm nhạc**\nKiểm tra đúng voice channel, âm lượng Discord và quyền truy cập micro/âm thanh của ứng dụng. Nếu vẫn có vấn đề, nói rõ là không nghe được nhạc, không vào voice, mic không hoạt động hay bị rè, kèm thiết bị đang dùng." };
  if (/(bao cao|report|vi pham|spam|quay roi|bat nat|cong kich|lua dao|scam|donate lua|noi dung doc hai|mod|moderator|admin)/.test(text)) return { key: "safety-report", response: "🛡️ **Báo cáo sự cố / hành vi vi phạm**\nĐừng đôi co hoặc công khai thông tin riêng tư. Gửi bằng chứng, link tin nhắn và mô tả ngắn cho Moderator/Staff qua kênh hỗ trợ phù hợp. Nếu có nguy cơ mất an toàn, báo staff ngay." };
  if (/(gop y|de xuat|y tuong|phan hoi|feedback|kien nghi)/.test(text)) return { key: "feedback", response: "📮 **Gửi góp ý cho POSTLAIN**\nVào phòng góp ý và dùng /feedback send để gửi nội dung. Góp ý sẽ được chuyển đến hộp thư quản trị. Cứ nói rõ vấn đề, đề xuất và lý do, càng cụ thể càng dễ xử lý." };
  if (/(luat|noi quy|quy dinh|rules|bi cam|mute|ban|kick)/.test(text)) return { key: "server-rules", response: "📜 **Nội quy server**\nTìm phòng nội quy / rules và đọc các thông báo được ghim trước nhé. Nếu có điều khoản chưa rõ hoặc nghĩ rằng mình bị xử lý nhầm, hỏi Moderator/Staff và gửi kèm ngữ cảnh liên quan." };
  if (/(loi|error|bug|khong duoc|khong hoat dong|khong thay|crash|treo|ket noi|connection|timeout)/.test(text)) return { key: "technical-issue", response: "🧰 **Tiếp nhận lỗi kỹ thuật**\nĐể khoanh vùng nhanh, gửi giúp: (1) mày đang thao tác gì, (2) kết quả mong muốn, (3) chuyện gì thực sự xảy ra, (4) ảnh hoặc nguyên văn lỗi, (5) thiết bị đang dùng. Đừng gửi mật khẩu, token hay mã xác thực." };
  return { key: "general-help", response: "🙋 **POSTLAIN Support đã nhận tín hiệu!**\nMày đang cần hỗ trợ gì? Viết rõ vấn đề, đang ở phòng nào và điều gì chưa hoạt động. Nếu có lỗi, gửi ảnh hoặc nguyên văn thông báo. Staff sẽ vào xử lý những việc cần quyền quản trị." };
}
export function isHelpRequest(content) { return Boolean(classifySupportMessage(content)); }
export function isProactiveCandidate(content) { return Boolean(classifySupportMessage(content)); }

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
    if (!content || await this.isExcluded(message.channel_id, message)) return;
    const support = classifySupportMessage(content);
    if (!support) return;
    const authorId = String(message.author?.id || "");
    if (!authorId || !this.canSendProactive(message.channel_id, authorId)) return;
    console.log("POSTLAIN support keyword detected", { category: support.key, channelId: message.channel_id, messageId: message.id });
    await this.replyWithSupport(message, support.response);
  }

  canSendProactive(channelId, authorId, now = Date.now()) {
    const globalCount = this.ctx.storage.sql.exec("SELECT COUNT(*) AS count FROM proactive_replies WHERE created_at > ?", now - 60 * 60 * 1000).toArray()[0]?.count || 0;
    if (globalCount >= 8) return false;
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
      return;
    }
    const now = Date.now();
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO proactive_replies (id, channel_id, author_id, created_at) VALUES (?, ?, ?, ?)", message.id, message.channel_id, authorId, now);
    this.ctx.storage.sql.exec("DELETE FROM proactive_replies WHERE created_at < ?", now - 24 * 60 * 60 * 1000);
    console.log("POSTLAIN support reply sent", { channelId: message.channel_id, messageId: message.id });
  }

}
