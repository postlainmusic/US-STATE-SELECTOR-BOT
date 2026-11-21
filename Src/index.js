import { DiscordGateway } from "./gateway.js";
import { handleVoiceCommand } from "./voice.js";
import { createVtvRound, VTV_QUESTIONS } from "./vtv-questions.js";

export { DiscordGateway };

const API = "https://discord.com/api/v10";

const REGIONS = [
  { key: "northeast", label: "01  /  NORTHEAST", emoji: "🌃", states: ["Connecticut","Maine","Massachusetts","New Hampshire","New Jersey","New York","Pennsylvania","Rhode Island","Vermont"] },
  { key: "midwest", label: "02  /  MIDWEST", emoji: "🌾", states: ["Illinois","Indiana","Iowa","Kansas","Michigan","Minnesota","Missouri","Nebraska","North Dakota","Ohio","South Dakota","Wisconsin"] },
  { key: "south", label: "03  /  SOUTH", emoji: "☀️", states: ["Alabama","Arkansas","Delaware","Florida","Georgia","Kentucky","Louisiana","Maryland","Mississippi","North Carolina","Oklahoma","South Carolina","Tennessee","Texas","Virginia","West Virginia"] },
  { key: "west", label: "04  /  WEST", emoji: "🏔️", states: ["Alaska","Arizona","California","Colorado","Hawaii","Idaho","Montana","Nevada","New Mexico","Oregon","Utah","Washington","Wyoming"] }
];

const COLORS = { background: 0x111827, accent: 0x4F8CFF };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function verifyDiscordRequest(request, body, publicKey) {
  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");
  if (!signature || !timestamp || !publicKey) return false;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      hexToBytes(publicKey),
      { name: "Ed25519" },
      false,
      ["verify"]
    );
    return await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      hexToBytes(signature),
      new TextEncoder().encode(timestamp + body)
    );
  } catch {
    return false;
  }
}

function panelComponents() {
  const rows = REGIONS.map(region => ({
    type: 1,
    components: [{
      type: 3,
      custom_id: `state_select:${region.key}`,
      placeholder: `${region.emoji}  ${region.label}  ·  Choose one state`,
      min_values: 1,
      max_values: 1,
      options: region.states.map(name => ({
        label: name,
        value: name,
        description: `Represent ${name}`
      }))
    }]
  }));
  rows.push({
    type: 1,
    components: [{
      type: 2,
      style: 2,
      custom_id: "state_remove",
      label: "REMOVE MY STATE",
      emoji: { name: "✕" }
    }]
  });
  return rows;
}

function panelMessage() {
  return {
    embeds: [{
      color: COLORS.background,
      title: "▰  STATE SELECTOR",
      description:
        "**CHOOSE YOUR TERRITORY. REPRESENT YOUR STATE.**\n" +
        "Select one U.S. state to display on your profile.\n\n" +
        "```ansi\n\\u001b[1;34m  50 STATES  /  04 REGIONS  /  01 SELECTION\\u001b[0m\n```" +
        "**01  /  NORTHEAST**  ·  9 states\n" +
        "**02  /  MIDWEST**  ·  12 states\n" +
        "**03  /  SOUTH**  ·  16 states\n" +
        "**04  /  WEST**  ·  13 states",
      fields: [
        { name: "◈  SELECTION RULE", value: "One member can hold **ONE** state role at a time. Choosing another state automatically replaces the previous one.", inline: false },
        { name: "⌁  CHANGE OR CLEAR", value: "Choose a different state to switch, or use **REMOVE MY STATE** to clear your selection.", inline: false }
      ],
      footer: { text: "STATE SELECTOR  /  COMMUNITY IDENTITY SYSTEM" }
    }],
    components: panelComponents()
  };
}

async function discord(path, env, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`Discord API ${response.status}: ${raw.slice(0, 500)}`);
  return raw ? JSON.parse(raw) : null;
}

function roleMap(env) {
  let map;
  try { map = JSON.parse(env.STATE_ROLE_IDS || "{}"); }
  catch { throw new Error("STATE_ROLE_IDS must be valid JSON."); }
  const names = REGIONS.flatMap(region => region.states);
  const missing = names.filter(name => !map[name]);
  if (missing.length) throw new Error(`Missing role IDs: ${missing.join(", ")}`);
  return map;
}

async function updateMemberState(env, guildId, userId, selectedState) {
  const map = roleMap(env);
  const stateRoleIds = new Set(Object.values(map));
  const member = await discord(`/guilds/${guildId}/members/${userId}`, env);
  const currentRoles = Array.isArray(member.roles) ? member.roles : [];
  const preservedRoles = currentRoles.filter(roleId => !stateRoleIds.has(roleId));
  const nextRoles = selectedState
    ? [...preservedRoles, map[selectedState]]
    : preservedRoles;
  await discord(`/guilds/${guildId}/members/${userId}`, env, {
    method: "PATCH",
    body: JSON.stringify({ roles: nextRoles })
  });
}

async function editInteractionPayload(env, interaction, payload) {
  const url = `${API}/webhooks/${env.DISCORD_APPLICATION_ID}/${interaction.token}/messages/@original`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, allowed_mentions: { parse: [] } })
  });
  if (!response.ok) {
    const body = await response.text();
    console.error("Could not edit interaction response:", response.status, body);
    throw new Error(`Interaction response update failed: ${response.status}`);
  }
}

async function editInteractionResponse(env, interaction, content) {
  return editInteractionPayload(env, interaction, { content });
}

function isManageRoles(interaction) {
  const permissions = BigInt(interaction.member?.permissions || "0");
  return (permissions & 268435456n) === 268435456n;
}


function optionValue(interaction, name) {
  const options = interaction.data?.options || [];
  for (const option of options) {
    if (option.name === name) return option.value;
    const nested = option.options?.find(item => item.name === name);
    if (nested) return nested.value;
  }
  return undefined;
}

function hasPermission(interaction, permission) {
  const value = BigInt(interaction.member?.permissions || "0");
  return (value & 8n) === 8n || (value & BigInt(permission)) === BigInt(permission);
}

function ephemeral(content) {
  return json({ type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] } } });
}

function helpPanel(category = "games") {
  const sections = {
    games: {
      title: "Trò chơi",
      description: "Chọn một trò chơi và tham gia ngay trong kênh được thiết lập.",
      fields: [
        { name: "Nối từ", value: "Gửi cụm gồm **2 tiếng**. Tiếng đầu phải khớp với tiếng cuối của lượt trước. Không lặp cụm và không đi hai lượt liên tiếp. Mỗi lượt có 30 giây.", inline: false },
        { name: "Lệnh", value: "`/noitu start` mở ván · `/noitu end` kết thúc · `/noitu score` xem bảng xếp hạng", inline: false },
        { name: "Hồ sơ & từ điển", value: "`/nme` hồ sơ · `/nrank` bảng xếp hạng · `/de-xuat-tu` đề xuất cụm còn thiếu · `/them-tu` thêm từ (Admin) · `/duyet-tu` duyệt (Admin)", inline: false },
        { name: "Gold & mini game", value: "`/daily` nhận Gold · `/ngold` số dư · `/grank` top Gold · `/baucua` Bầu Cua · `/xu-xi` Kéo Búa Bao", inline: false },
        { name: "Đố vui", value: "`/vtv` Vua Tiếng Việt · `/vtvrank` bảng xếp hạng · `/ncf` tung xu · `/ntxx` xúc xắc", inline: false }
      ]
    },
    community: {
      title: "Cộng đồng",
      description: "Các công cụ dành cho thành viên.",
      fields: [
        { name: "Thông tin", value: "`/ping` · `/serverinfo` · `/userinfo` · `/avatar`", inline: false },
        { name: "Tương tác", value: "`/report send` · `/poll create` · `/coinflip` · `/roll` · `/choose`", inline: false },
        { name: "Vai trò & góp ý", value: "`/statepanel publish` · `/feedback send`", inline: false }
      ]
    },
    voice: {
      title: "Voice",
      description: "Công cụ kết nối và phát giọng nói trong voice channel.",
      fields: [
        { name: "Điều khiển", value: "`/join` tham gia · `/leave` rời phòng", inline: false },
        { name: "Đọc văn bản", value: "`/speak` nhập nội dung, ngôn ngữ và giọng đọc", inline: false },
        { name: "Trạng thái", value: "`/voice status` xem trạng thái · `/voice stop` dừng phát", inline: false }
      ]
    },
    admin: {
      title: "Quản trị",
      description: "Các lệnh dành cho đội ngũ có quyền phù hợp.",
      fields: [
        { name: "Thông báo", value: "`/noti send` gửi thông báo đến kênh được chọn", inline: false },
        { name: "Kiểm duyệt", value: "`/purge` · `/slowmode` · `/lock` · `/unlock`", inline: false },
        { name: "Từ điển nối từ", value: "`/them-tu` thêm cụm 2 tiếng vào danh sách được chấp nhận", inline: false }
      ]
    }
  };
  const selected = sections[category] || sections.games;
  return {
    embeds: [{
      color: COLORS.accent,
      title: selected.title,
      description: selected.description,
      fields: selected.fields,
      footer: { text: "Chọn một mục bên dưới để xem hướng dẫn" }
    }],
    components: [{
      type: 1,
      components: [{
        type: 3,
        custom_id: "help_category",
        placeholder: "Chọn danh mục",
        min_values: 1,
        max_values: 1,
        options: [
          { label: "Trò chơi", value: "games", description: "Nối từ và hồ sơ trò chơi" },
          { label: "Cộng đồng", value: "community", description: "Thông tin và công cụ thành viên" },
          { label: "Voice", value: "voice", description: "Kết nối và đọc văn bản" },
          { label: "Quản trị", value: "admin", description: "Thông báo và kiểm duyệt" }
        ]
      }]
    }]
  };
}

function avatarUrl(user) {
  if (user?.avatar) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256`;
  const index = Number((BigInt(user?.id || "0") >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

async function setChannelLock(env, channelId, guildId, locked) {
  const channel = await discord(`/channels/${channelId}`, env);
  if (![0, 5].includes(Number(channel.type))) throw new Error("Lock/unlock currently supports text and announcement channels only.");
  const overwrites = Array.isArray(channel.permission_overwrites) ? channel.permission_overwrites : [];
  const current = overwrites.find(item => item.id === guildId && Number(item.type) === 0);
  if (!current && !locked) return false;
  const sendMessages = 2048n;
  let allow = BigInt(current?.allow || "0");
  let deny = BigInt(current?.deny || "0");
  if (locked) {
    allow &= ~sendMessages;
    deny |= sendMessages;
  } else {
    deny &= ~sendMessages;
  }
  if (!allow && !deny) {
    if (current) {
      const response = await fetch(`${API}/channels/${channelId}/permissions/${guildId}?type=0`, {
        method: "DELETE",
        headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` }
      });
      if (!response.ok) throw new Error(`Discord API ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    return true;
  }
  const response = await fetch(`${API}/channels/${channelId}/permissions/${guildId}?type=0`, {
    method: "PUT",
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ type: 0, allow: allow.toString(), deny: deny.toString() })
  });
  if (!response.ok) throw new Error(`Discord API ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return true;
}

async function handleInteraction(interaction, env, ctx) {
  if (interaction.type === 1) return json({ type: 1 });

  if (interaction.type === 2) {
    const command = interaction.data?.name;
    const subcommand = interaction.data?.options?.[0]?.name;
    const voiceResponse = await handleVoiceCommand(interaction, env, ctx);
    if (voiceResponse) return voiceResponse;

    // Community feedback relay: accept feedback only from the designated room.
    if (command === "feedback" && subcommand === "send") {
      const FEEDBACK_CHANNEL_ID = "1572558507067310160";
      const ADMIN_INBOX_CHANNEL_ID = "1573304587795038319";
      if (interaction.channel_id !== FEEDBACK_CHANNEL_ID) {
        return json({ type: 4, data: { content: "📮 Lệnh này chỉ dùng trong phòng góp ý. / This command can only be used in the feedback channel.", flags: 64 } });
      }
      const message = interaction.data?.options?.[0]?.options?.find(option => option.name === "message")?.value;
      if (typeof message !== "string" || !message.trim()) {
        return json({ type: 4, data: { content: "Vui lòng nhập nội dung góp ý. / Please enter your feedback.", flags: 64 } });
      }
      if (message.length > 3500) {
        return json({ type: 4, data: { content: "Góp ý vượt quá giới hạn 3.500 ký tự. / Feedback exceeds the 3,500-character limit.", flags: 64 } });
      }
      const user = interaction.member?.user || interaction.user || {};
      const username = user.global_name || user.username || "Unknown user";
      const userId = user.id || "Unknown ID";
      const deferred = json({ type: 5, data: { flags: 64 } });
      const work = (async () => {
        try {
          await discord(`/channels/${ADMIN_INBOX_CHANNEL_ID}/messages`, env, {
            method: "POST",
            body: JSON.stringify({
              embeds: [{
                color: 0x4F8CFF,
                title: "📩 NEW COMMUNITY FEEDBACK",
                description: message,
                fields: [
                  { name: "Sender", value: `${username} (<@${userId}>)\nUser ID: ${userId}`, inline: false },
                  { name: "Source", value: `<#${FEEDBACK_CHANNEL_ID}>`, inline: true }
                ],
                footer: { text: "Community Feedback Inbox" },
                timestamp: new Date().toISOString()
              }],
              allowed_mentions: { parse: [] }
            })
          });
          await editInteractionResponse(env, interaction, "✅ Đã nhận thông tin. Cảm ơn bạn đã gửi góp ý! / Your feedback has been received. Thank you!");
        } catch (error) {
          console.error("Feedback relay failed:", error);
          await editInteractionResponse(env, interaction, "❌ Chưa gửi được góp ý. Vui lòng thử lại sau hoặc báo quản trị viên. / Could not submit feedback. Please try again later.");
        }
      })();
      ctx.waitUntil(work);
      return deferred;
    }

    // Admin notification relay: admins choose the destination text channel.
    if (command === "noti" && subcommand === "send") {
      const ADMIN_CHANNEL_ID = "1573302128351645706";
      const sourceChannelId = interaction.channel_id;
      const permissions = BigInt(interaction.member?.permissions || "0");
      const isAdmin = (permissions & 8n) === 8n;
      if (sourceChannelId !== ADMIN_CHANNEL_ID || !isAdmin) {
        return json({ type: 4, data: { content: "⛔ Lệnh này chỉ dành cho Admin trong phòng thông báo quản trị. / Admin-only command in the admin notification room.", flags: 64 } });
      }

      const destinationId = optionValue(interaction, "channel");
      const message = optionValue(interaction, "message");
      if (!destinationId || typeof destinationId !== "string") {
        return ephemeral("⚠️ Hãy chọn phòng nhận thông báo trước khi gửi.");
      }
      if (typeof message !== "string" || !message.trim()) {
        return ephemeral("Vui lòng nhập nội dung thông báo.");
      }
      if (message.trim().length > 2000) {
        return ephemeral("Thông báo vượt quá giới hạn 2.000 ký tự.");
      }

      const deferred = json({ type: 5, data: { flags: 64 } });
      const work = (async () => {
        try {
          const destination = await discord(`/channels/${destinationId}`, env);
          if (String(destination.guild_id || "") !== String(interaction.guild_id || "")) {
            await editInteractionResponse(env, interaction, "❌ Phòng nhận không thuộc server này. Hãy chọn một phòng trong POSTLAIN Discord.");
            return;
          }
          if (![0, 5].includes(Number(destination.type))) {
            await editInteractionResponse(env, interaction, "❌ Chỉ hỗ trợ phòng văn bản hoặc phòng thông báo. Không thể gửi vào voice, forum hay category.");
            return;
          }

          await discord(`/channels/${destinationId}/messages`, env, {
            method: "POST",
            body: JSON.stringify({
              content: message.trim(),
              allowed_mentions: { parse: [], users: [], roles: [], replied_user: false }
            })
          });
          const channelLabel = destination.name ? `#${destination.name}` : `<#${destinationId}>`;
          await editInteractionResponse(env, interaction, `✅ Đã gửi thông báo thành công đến **${channelLabel}**.\n\n<#${destinationId}>`);
        } catch (error) {
          console.error("Notification relay failed:", error);
          const detail = String(error?.message || error);
          const hint = /50013|Missing Permissions|403/i.test(detail)
            ? "Bot chưa có quyền View Channel và Send Messages tại phòng nhận."
            : "Kiểm tra lại phòng nhận và quyền của bot, sau đó thử lại.";
          await editInteractionResponse(env, interaction, `❌ Không gửi được thông báo. ${hint}`);
        }
      })();
      ctx.waitUntil(work);
      return deferred;
    }




    if (command === "noitu") {
      const action = interaction.data?.options?.[0]?.name;
      const GAME_CHANNEL_ID = "1573644570997035100";
      if (String(interaction.channel_id || "") !== GAME_CHANNEL_ID) return ephemeral("🎮 Trò nối từ chỉ hoạt động tại <#" + GAME_CHANNEL_ID + "> nhé.");
      const userId = String(interaction.member?.user?.id || interaction.user?.id || "");
      const gateway = env.GATEWAY.get(env.GATEWAY.idFromName("postlain-ai-gateway"));
      if (action === "start") {
        const result = await gateway.fetch("https://gateway/wordchain/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }) });
        return ephemeral((await result.json()).message || "Không thể mở ván mới.");
      }
      if (action === "end") {
        const result = await gateway.fetch("https://gateway/wordchain/end", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, isAdmin: hasPermission(interaction, 8) }) });
        return ephemeral((await result.json()).message || "Không thể kết thúc ván.");
      }
      if (action === "score") {
        const result = await gateway.fetch("https://gateway/wordchain/score");
        return ephemeral((await result.json()).message || "Chưa có bảng xếp hạng.");
      }
    }

    if (command === "nme") {
      const GAME_CHANNEL_ID = "1573644570997035100";
      if (String(interaction.channel_id || "") !== GAME_CHANNEL_ID) return ephemeral("🎮 Lệnh hồ sơ chỉ dùng trong phòng nối từ.");
      const targetId = String(optionValue(interaction, "user") || interaction.member?.user?.id || interaction.user?.id || "");
      const gateway = env.GATEWAY.get(env.GATEWAY.idFromName("postlain-ai-gateway"));
      const result = await gateway.fetch("https://gateway/wordchain/profile?userId=" + encodeURIComponent(targetId));
      return ephemeral((await result.json()).message || "Chưa lấy được hồ sơ.");
    }

    if (command === "nrank") {
      const GAME_CHANNEL_ID = "1573644570997035100";
      if (String(interaction.channel_id || "") !== GAME_CHANNEL_ID) return ephemeral("🎮 Bảng xếp hạng chỉ dùng trong phòng nối từ.");
      const gateway = env.GATEWAY.get(env.GATEWAY.idFromName("postlain-ai-gateway"));
      const result = await gateway.fetch("https://gateway/wordchain/leaderboard");
      return ephemeral((await result.json()).message || "Chưa có bảng xếp hạng.");
    }

    if (command === "de-xuat-tu") {
      const userId = String(interaction.member?.user?.id || interaction.user?.id || "");
      const word = String(optionValue(interaction, "word") || "");
      const gateway = env.GATEWAY.get(env.GATEWAY.idFromName("postlain-ai-gateway"));
      const result = await gateway.fetch("https://gateway/wordchain/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, word })
      });
      return ephemeral((await result.json()).message || "Không gửi được đề xuất.");
    }

    if (command === "duyet-tu" || command === "tu-choi-tu") {
      if (!hasPermission(interaction, 8)) return ephemeral("Chỉ Admin mới có thể duyệt đề xuất.");
      const userId = String(interaction.member?.user?.id || interaction.user?.id || "");
      const id = Number(optionValue(interaction, "id") || 0);
      const gateway = env.GATEWAY.get(env.GATEWAY.idFromName("postlain-ai-gateway"));
      const result = await gateway.fetch("https://gateway/wordchain/review-suggestion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, id, isAdmin: true, action: command === "duyet-tu" ? "approve" : "reject" })
      });
      return ephemeral((await result.json()).message || "Không thể xử lý đề xuất.");
    }

    if (command === "them-tu") {
      const GAME_CHANNEL_ID = "1573644570997035100";
      if (String(interaction.channel_id || "") !== GAME_CHANNEL_ID) return ephemeral("📚 Lệnh bổ sung từ chỉ dùng trong phòng nối từ.");
      if (!hasPermission(interaction, 8)) return ephemeral("⛔ Chỉ Admin mới được bổ sung từ điển để tránh thêm từ sai.");
      const word = String(optionValue(interaction, "word") || "");
      const userId = String(interaction.member?.user?.id || interaction.user?.id || "");
      const gateway = env.GATEWAY.get(env.GATEWAY.idFromName("postlain-ai-gateway"));
      const result = await gateway.fetch("https://gateway/wordchain/add-word", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word, userId, isAdmin: true })
      });
      return ephemeral((await result.json()).message || "Không thể bổ sung từ.");
    }

    if (command === "daily") {
      const userId = String(interaction.member?.user?.id || interaction.user?.id || "");
      const gateway = env.GATEWAY.get(env.GATEWAY.idFromName("postlain-ai-gateway"));
      const result = await gateway.fetch("https://gateway/games/daily", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, interactionId: String(interaction.id || "") })
      });
      return ephemeral((await result.json()).message || "Chưa thể điểm danh lúc này.");
    }

    if (command === "ngold") {
      const userId = String(interaction.member?.user?.id || interaction.user?.id || "");
      const gateway = env.GATEWAY.get(env.GATEWAY.idFromName("postlain-ai-gateway"));
      const result = await gateway.fetch("https://gateway/games/balance?userId=" + encodeURIComponent(userId));
      return ephemeral((await result.json()).message || "Chưa lấy được số dư.");
    }

    if (command === "grank") {
      const gateway = env.GATEWAY.get(env.GATEWAY.idFromName("postlain-ai-gateway"));
      const result = await gateway.fetch("https://gateway/games/leaderboard");
      return ephemeral((await result.json()).message || "Chưa có bảng xếp hạng Gold.");
    }

    if (command === "baucua") {
      const userId = String(interaction.member?.user?.id || interaction.user?.id || "");
      const animal = String(optionValue(interaction, "animal") || "");
      const amount = Number(optionValue(interaction, "amount") || 0);
      const gateway = env.GATEWAY.get(env.GATEWAY.idFromName("postlain-ai-gateway"));
      const result = await gateway.fetch("https://gateway/games/baucua", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, animal, amount, interactionId: String(interaction.id || "") })
      });
      return ephemeral((await result.json()).message || "Chưa thể chơi Bầu Cua lúc này.");
    }

    if (command === "xu-xi") {
      const userId = String(interaction.member?.user?.id || interaction.user?.id || "");
      const choice = String(optionValue(interaction, "choice") || "");
      const amount = Number(optionValue(interaction, "amount") || 0);
      const gateway = env.GATEWAY.get(env.GATEWAY.idFromName("postlain-ai-gateway"));
      const result = await gateway.fetch("https://gateway/games/xuxi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, choice, amount, interactionId: String(interaction.id || "") })
      });
      return ephemeral((await result.json()).message || "Chưa thể chơi Xù Xì lúc này.");
    }

    if (command === "vtv") {
      const question = createVtvRound(crypto.getRandomValues(new Uint32Array(1))[0] / 0x100000000);
      const roundId = String(interaction.id || crypto.randomUUID());
      const gateway = env.GATEWAY.get(env.GATEWAY.idFromName("postlain-ai-gateway"));
      const created = await gateway.fetch("https://gateway/games/vtv/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roundId, questionId: question.id, correctIndex: question.answer })
      });
      if (!created.ok) return ephemeral("Không thể tạo câu hỏi lúc này. Thử lại nhé.");
      const components = [{
        type: 1,
        components: question.options.map((label, index) => ({
          type: 2,
          style: 2,
          label,
          custom_id: "vtv:" + roundId + ":" + index
        }))
      }];
      return json({
        type: 4,
        data: {
          embeds: [{
            color: COLORS.accent,
            title: "Vua Tiếng Việt",
            description: question.prompt,
            footer: { text: "Ai trả lời đúng đầu tiên sẽ ghi điểm." }
          }],
          components,
          allowed_mentions: { parse: [] }
        }
      });
    }

    if (command === "vtvrank") {
      const gateway = env.GATEWAY.get(env.GATEWAY.idFromName("postlain-ai-gateway"));
      const result = await gateway.fetch("https://gateway/games/vtv/leaderboard");
      return ephemeral((await result.json()).message || "Chưa có bảng xếp hạng Vua Tiếng Việt.");
    }

    if (command === "coinflip" || command === "ncf") {
      const result = crypto.getRandomValues(new Uint8Array(1))[0] % 2 === 0 ? "🪙 **Heads**" : "🪙 **Tails**";
      return ephemeral(result);
    }

    if (command === "roll" || command === "ntxx") {
      const sides = Number(optionValue(interaction, "sides") || 6);
      if (!Number.isInteger(sides) || sides < 2 || sides > 1000) return ephemeral("Số mặt xúc xắc phải từ 2 đến 1.000.");
      const bytes = new Uint32Array(1);
      crypto.getRandomValues(bytes);
      const result = (bytes[0] % sides) + 1;
      return ephemeral(`🎲 Xúc xắc d${sides}: **${result}**`);
    }

    if (command === "choose") {
      const raw = String(optionValue(interaction, "options") || "");
      const choices = raw.split(",").map(value => value.trim()).filter(Boolean).slice(0, 30);
      if (choices.length < 2) return ephemeral("Nhập ít nhất 2 lựa chọn, ngăn cách bằng dấu phẩy.");
      const bytes = new Uint32Array(1);
      crypto.getRandomValues(bytes);
      const selected = choices[bytes[0] % choices.length];
      return ephemeral(`🎯 POSTLAIN chọn: **${selected.slice(0, 180)}**\n(${choices.length} lựa chọn)`);
    }

    if (command === "help") {
      return json({ type: 4, data: { ...helpPanel("games"), flags: 64 } });
    }

    if (command === "ping") {
      let delay = null;
      try { delay = Math.max(0, Date.now() - Number((BigInt(interaction.id) >> 22n) + 1420070400000n)); } catch {}
      return ephemeral(delay === null ? "🏓 Pong! POSTLAIN đang hoạt động." : `🏓 Pong! Lệnh được xử lý sau khoảng ${delay} ms từ lúc Discord tạo interaction.`);
    }

    if (command === "serverinfo") {
      if (!interaction.guild_id) return ephemeral("Lệnh này chỉ dùng trong server.");
      const deferred = json({ type: 5, data: { flags: 64 } });
      ctx.waitUntil((async () => {
        try {
          const guild = await discord(`/guilds/${interaction.guild_id}?with_counts=true`, env);
          const owner = guild.owner_id ? `<@${guild.owner_id}>` : "Unknown";
          const created = new Date(Number((BigInt(guild.id) >> 22n) + 1420070400000n)).toLocaleDateString("vi-VN");
          const embed = {
            color: COLORS.accent,
            title: guild.name || "Server information",
            description: guild.description || "POSTLAIN community server",
            fields: [
              { name: "👥 Members", value: String(guild.approximate_member_count ?? guild.member_count ?? "N/A"), inline: true },
              { name: "🚀 Boosts", value: String(guild.premium_subscription_count ?? 0), inline: true },
              { name: "👑 Owner", value: owner, inline: true },
              { name: "📅 Created", value: created, inline: true },
              { name: "🛡️ Verification", value: String(guild.verification_level ?? "N/A"), inline: true },
              { name: "🌐 Locale", value: String(guild.preferred_locale || "N/A"), inline: true }
            ],
            thumbnail: guild.icon ? { url: `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=256` } : undefined,
            footer: { text: `Server ID: ${guild.id}` }
          };
          await editInteractionPayload(env, interaction, { content: null, embeds: [embed] });
        } catch (error) {
          console.error("Server info failed:", error);
          await editInteractionResponse(env, interaction, "Không lấy được thông tin server. Thử lại sau nhé.");
        }
      })());
      return deferred;
    }

    if (command === "userinfo" || command === "avatar") {
      if (!interaction.guild_id) return ephemeral("Lệnh này chỉ dùng trong server.");
      const targetId = optionValue(interaction, "user") || interaction.member?.user?.id || interaction.user?.id;
      if (!targetId) return ephemeral("Không xác định được thành viên.");
      const deferred = json({ type: 5, data: { flags: 64 } });
      ctx.waitUntil((async () => {
        try {
          const [user, member] = await Promise.all([
            discord(`/users/${targetId}`, env),
            command === "userinfo" ? discord(`/guilds/${interaction.guild_id}/members/${targetId}`, env) : Promise.resolve(null)
          ]);
          const image = avatarUrl(user);
          if (command === "avatar") {
            await editInteractionPayload(env, interaction, {
              content: null,
              embeds: [{ color: COLORS.accent, title: `Avatar · ${user.global_name || user.username || "Member"}`, image: { url: image } }]
            });
            return;
          }
          const joined = member?.joined_at ? new Date(member.joined_at).toLocaleString("vi-VN") : "N/A";
          const created = new Date(Number((BigInt(user.id) >> 22n) + 1420070400000n)).toLocaleString("vi-VN");
          const roles = (member?.roles || []).length;
          const embed = {
            color: COLORS.accent,
            title: member?.nick || user.global_name || user.username || "User",
            description: `<@${user.id}>\n${user.bot ? "🤖 Bot account" : "👤 Member"}`,
            thumbnail: { url: image },
            fields: [
              { name: "📅 Account created", value: created, inline: true },
              { name: "🏠 Joined server", value: joined, inline: true },
              { name: "🎭 Role count", value: String(roles), inline: true },
              { name: "🆔 User ID", value: user.id, inline: false }
            ],
            footer: { text: "POSTLAIN Member Card" }
          };
          await editInteractionPayload(env, interaction, { content: null, embeds: [embed] });
        } catch (error) {
          console.error("Member lookup failed:", error);
          await editInteractionResponse(env, interaction, "Không tìm được thành viên này trong server.");
        }
      })());
      return deferred;
    }

    if (command === "report" && subcommand === "send") {
      const details = String(optionValue(interaction, "details") || "").trim();
      const staffChannel = String(env.SUPPORT_STAFF_CHANNEL_ID || "");
      if (!details || !staffChannel) return ephemeral("Chưa cấu hình nơi nhận báo cáo hoặc nội dung đang trống.");
      const user = interaction.member?.user || interaction.user || {};
      const deferred = json({ type: 5, data: { flags: 64 } });
      ctx.waitUntil((async () => {
        try {
          await discord(`/channels/${staffChannel}/messages`, env, {
            method: "POST",
            body: JSON.stringify({
              embeds: [{
                color: 0xE05D5D,
                title: "🛡️ MEMBER REPORT",
                description: details.slice(0, 1800),
                fields: [
                  { name: "Reporter", value: `<@${user.id}> · ${user.username || "Unknown"}`, inline: true },
                  { name: "Location", value: interaction.channel_id ? `<#${interaction.channel_id}>` : "DM", inline: true }
                ],
                timestamp: new Date().toISOString(),
                footer: { text: "POSTLAIN Community Safety" }
              }],
              allowed_mentions: { parse: [] }
            })
          });
          await editInteractionResponse(env, interaction, "✅ Đã chuyển báo cáo đến đội ngũ Staff. Cảm ơn mày đã thông tin.");
        } catch (error) {
          console.error("Member report failed:", error);
          await editInteractionResponse(env, interaction, "❌ Chưa gửi được báo cáo. Hãy liên hệ Moderator trực tiếp.");
        }
      })());
      return deferred;
    }

    if (command === "poll" && subcommand === "create") {
      const question = String(optionValue(interaction, "question") || "").trim();
      if (!question || question.length > 240) return ephemeral("Câu hỏi phải có từ 1 đến 240 ký tự.");
      const deferred = json({ type: 5, data: { flags: 64 } });
      ctx.waitUntil((async () => {
        try {
          const poll = await discord(`/channels/${interaction.channel_id}/messages`, env, {
            method: "POST",
            body: JSON.stringify({
              embeds: [{
                color: COLORS.accent,
                title: "📊 COMMUNITY POLL",
                description: `**${question}**\n\n👍  Đồng ý\n👎  Không đồng ý\n🤷  Không có ý kiến`,
                footer: { text: `Created by ${interaction.member?.user?.global_name || interaction.user?.username || "a member"} · React to vote` },
                timestamp: new Date().toISOString()
              }],
              allowed_mentions: { parse: [] }
            })
          });
          for (const emoji of ["👍", "👎", "🤷"]) {
            const path = `/channels/${interaction.channel_id}/messages/${poll.id}/reactions/${encodeURIComponent(emoji)}/@me`;
            const response = await fetch(`${API}${path}`, { method: "PUT", headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } });
            if (!response.ok) console.warn("Could not seed poll reaction:", emoji, response.status);
          }
          await editInteractionResponse(env, interaction, "📊 Đã tạo bình chọn. Thành viên có thể thả reaction để bỏ phiếu.");
        } catch (error) {
          console.error("Poll creation failed:", error);
          await editInteractionResponse(env, interaction, "❌ Không tạo được bình chọn. Kiểm tra quyền gửi tin nhắn và thêm reaction của bot.");
        }
      })());
      return deferred;
    }

    if (command === "purge") {
      if (!hasPermission(interaction, 8192)) return ephemeral("⛔ Cần quyền Manage Messages để dùng lệnh này.");
      const amount = Number(optionValue(interaction, "amount") || 0);
      if (!Number.isInteger(amount) || amount < 2 || amount > 100) return ephemeral("Số lượng phải từ 2 đến 100.");
      const deferred = json({ type: 5, data: { flags: 64 } });
      ctx.waitUntil((async () => {
        try {
          const messages = await discord(`/channels/${interaction.channel_id}/messages?limit=${amount}`, env);
          const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
          const recent = (messages || []).filter(item => new Date(item.timestamp).getTime() > cutoff).map(item => item.id);
          if (!recent.length) return editInteractionResponse(env, interaction, "Không có tin nhắn đủ điều kiện xóa trong 14 ngày gần nhất.");
          if (recent.length === 1) {
            const response = await fetch(`${API}/channels/${interaction.channel_id}/messages/${recent[0]}`, { method: "DELETE", headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } });
            if (!response.ok) throw new Error(`Delete failed: ${response.status}`);
          } else {
            await discord(`/channels/${interaction.channel_id}/messages/bulk-delete`, env, { method: "POST", body: JSON.stringify({ messages: recent }) });
          }
          await editInteractionResponse(env, interaction, `🧹 Đã xóa ${recent.length} tin nhắn gần đây. Tin nhắn cũ hơn 14 ngày được bỏ qua.`);
        } catch (error) {
          console.error("Purge failed:", error);
          await editInteractionResponse(env, interaction, "❌ Không xóa được tin nhắn. Kiểm tra quyền Manage Messages và thử lại.");
        }
      })());
      return deferred;
    }

    if (command === "slowmode") {
      if (!hasPermission(interaction, 16)) return ephemeral("⛔ Cần quyền Manage Channels để dùng lệnh này.");
      const seconds = Number(optionValue(interaction, "seconds"));
      if (!Number.isInteger(seconds) || seconds < 0 || seconds > 21600) return ephemeral("Slowmode phải từ 0 đến 21.600 giây.");
      const deferred = json({ type: 5, data: { flags: 64 } });
      ctx.waitUntil((async () => {
        try {
          await discord(`/channels/${interaction.channel_id}`, env, { method: "PATCH", body: JSON.stringify({ rate_limit_per_user: seconds }) });
          await editInteractionResponse(env, interaction, seconds === 0 ? "⏱️ Đã tắt slowmode." : `⏱️ Đã đặt slowmode ${seconds} giây.`);
        } catch (error) {
          console.error("Slowmode failed:", error);
          await editInteractionResponse(env, interaction, "❌ Không đổi được slowmode. Kiểm tra quyền Manage Channels.");
        }
      })());
      return deferred;
    }

    if (command === "lock" || command === "unlock") {
      if (!hasPermission(interaction, 268435456)) return ephemeral("⛔ Cần quyền Manage Roles để chỉnh permission overwrite của kênh.");
      const locked = command === "lock";
      const deferred = json({ type: 5, data: { flags: 64 } });
      ctx.waitUntil((async () => {
        try {
          const changed = await setChannelLock(env, interaction.channel_id, interaction.guild_id, locked);
          await editInteractionResponse(env, interaction, locked ? "🔒 Đã khóa quyền gửi tin nhắn của @everyone tại kênh này." : (changed ? "🔓 Đã mở khóa quyền gửi tin nhắn của @everyone." : "Kênh này không có khóa @everyone để gỡ."));
        } catch (error) {
          console.error("Channel lock update failed:", error);
          await editInteractionResponse(env, interaction, "❌ Không thể đổi quyền kênh. Kiểm tra quyền Manage Channels.");
        }
      })());
      return deferred;
    }

    if (command !== "statepanel" || subcommand !== "publish") {
      return json({ type: 4, data: { content: "Unknown command.", flags: 64 } });
    }
    if (!isManageRoles(interaction)) {
      return json({ type: 4, data: { content: "You need Manage Roles permission to publish this panel.", flags: 64 } });
    }
    try {
      roleMap(env);
      return json({ type: 4, data: { ...panelMessage(), allowed_mentions: { parse: [] } } });
    } catch (error) {
      return json({ type: 4, data: { content: `Configuration error: ${error.message}`, flags: 64 } });
    }
  }

  if (interaction.type === 3) {
    const customId = interaction.data?.custom_id || "";
    if (customId.startsWith("vtv:")) {
      const parts = customId.split(":");
      const roundId = parts[1] || "";
      const choiceIndex = Number(parts[2]);
      const userId = String(interaction.member?.user?.id || interaction.user?.id || "");
      const gateway = env.GATEWAY.get(env.GATEWAY.idFromName("postlain-ai-gateway"));
      const result = await gateway.fetch("https://gateway/games/vtv/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roundId, choiceIndex, userId, interactionId: String(interaction.id || "") })
      });
      const answer = await result.json();
      if (answer.correct) {
        return json({
          type: 7,
          data: {
            content: answer.message + "\n**Đáp án:** " + (VTV_QUESTIONS.find(item => item.id === answer.questionId)?.options[answer.answerIndex] || "Đã ghi nhận") + "\n" + (VTV_QUESTIONS.find(item => item.id === answer.questionId)?.explanation || "") ,
            embeds: [],
            components: [{
              type: 1,
              components: [{
                type: 2,
                style: 2,
                label: "Đã có người trả lời đúng",
                custom_id: "vtv:closed",
                disabled: true
              }]
            }],
            allowed_mentions: { parse: [] }
          }
        });
      }
      return ephemeral(answer.message || "Câu hỏi đã kết thúc hoặc câu trả lời chưa đúng.");
    }
    if (customId === "help_category") {
      const category = interaction.data?.values?.[0] || "games";
      return json({ type: 7, data: helpPanel(category) });
    }
    const selectedState = customId === "state_remove"
      ? null
      : interaction.data?.values?.[0];

    const validStates = REGIONS.flatMap(region => region.states);
    const isSelect = customId.startsWith("state_select:");
    if (customId !== "state_remove" && (!isSelect || !validStates.includes(selectedState))) {
      return json({ type: 4, data: { content: "Invalid state selection.", flags: 64 } });
    }

    const guildId = interaction.guild_id;
    const userId = interaction.member?.user?.id;
    if (!guildId || !userId) {
      return json({ type: 4, data: { content: "This panel only works inside a server.", flags: 64 } });
    }

    // Defer immediately to stay within Discord's 3-second interaction deadline.
    const deferred = json({ type: 5, data: { flags: 64 } });
    // Continue the role operation after returning the acknowledgement.
    const work = (async () => {
      try {
        await updateMemberState(env, guildId, userId, selectedState);
        const message = selectedState
          ? `✓ Your state is now **${selectedState}**. Any previous state role has been replaced.`
          : "✓ Your state role has been removed.";
        await editInteractionResponse(env, interaction, message);
      } catch (error) {
        console.error(error);
        await editInteractionResponse(env, interaction, `Could not update your state role. Please contact a moderator.\nDetails: ${String(error.message).slice(0, 250)}`);
      }
    })();
    ctx.waitUntil(work);
    return deferred;
  }

  return json({ type: 4, data: { content: "Unsupported interaction.", flags: 64 } });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "state-selector-bot" });
    }
    if (request.method === "GET" && url.pathname === "/gateway/status") {
      if (!env.GATEWAY) {
        return json({ ok: false, state: "unavailable", error: "Durable Object binding GATEWAY is missing in this deployment." }, 503);
      }
      try {
        const gatewayId = env.GATEWAY.idFromName("postlain-ai-gateway");
        const gateway = env.GATEWAY.get(gatewayId);
        // A status visit also performs an idempotent connection check, useful for Preview smoke tests.
        await gateway.fetch("https://gateway/ensure");
        return await gateway.fetch("https://gateway/status");
      } catch (error) {
        console.error("POSTLAIN AI Gateway status failed:", String(error?.message || error), error?.stack || "");
        return json({
          ok: false,
          state: "error",
          error: String(error?.message || "Gateway runtime error").slice(0, 300),
          errorName: String(error?.name || "Error")
        }, 503);
      }
    }
    if (request.method !== "POST" || url.pathname !== "/interactions") {
      return json({ error: "Not found" }, 404);
    }

    const body = await request.text();
    const valid = await verifyDiscordRequest(request, body, env.DISCORD_PUBLIC_KEY);
    if (!valid) return new Response("Invalid request signature", { status: 401 });

    let interaction;
    try { interaction = JSON.parse(body); }
    catch { return new Response("Invalid JSON", { status: 400 }); }

    return handleInteraction(interaction, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (!env.GATEWAY) {
      console.error("POSTLAIN AI Gateway ensure skipped: Durable Object binding GATEWAY is missing.");
      return;
    }
    const gatewayId = env.GATEWAY.idFromName("postlain-ai-gateway");
    ctx.waitUntil(
      env.GATEWAY.get(gatewayId).fetch("https://gateway/ensure")
        .catch(error => console.error("POSTLAIN AI Gateway ensure failed:", String(error?.message || error), error?.stack || ""))
    );
  }
};
