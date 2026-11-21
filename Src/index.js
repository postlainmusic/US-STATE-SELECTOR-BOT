import { generateAnswer } from "./ai/engine.js";

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

async function editInteractionResponse(env, interaction, content) {
  const url = `${API}/webhooks/${env.DISCORD_APPLICATION_ID}/${interaction.token}/messages/@original`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } })
  });
  if (!response.ok) {
    const body = await response.text();
    console.error("Could not edit interaction response:", response.status, body);
  }
}

function isManageRoles(interaction) {
  const permissions = BigInt(interaction.member?.permissions || "0");
  return (permissions & 268435456n) === 268435456n;
}

function isAdmin(interaction) {
  const permissions = BigInt(interaction.member?.permissions || "0");
  return (permissions & 8n) === 8n;
}

function isKnowledgeEntry(message) {
  return message?.author?.bot === true && message?.embeds?.[0]?.title === "POSTLAIN KNOWLEDGE";
}

async function loadKnowledge(env) {
  if (!env.KNOWLEDGE_CHANNEL_ID) return "";
  const messages = await discord(`/channels/${env.KNOWLEDGE_CHANNEL_ID}/messages?limit=100`, env);
  const entries = messages.filter(isKnowledgeEntry).slice(0, 10).reverse();
  return entries.map((message, index) => {
    const embed = message.embeds[0];
    const topic = embed.fields?.find(field => field.name === "Topic")?.value || "General";
    return `${index + 1}. [${topic}] ${embed.description || ""}`;
  }).join("\n").slice(0, 12000);
}

async function handleKnowledgeCommand(interaction, env) {
  if (!isAdmin(interaction)) return json({ type: 4, data: { content: "⛔ Chỉ Admin mới được quản lý kiến thức POSTLAIN.", flags: 64 } });
  if (!env.KNOWLEDGE_CHANNEL_ID) return json({ type: 4, data: { content: "⚙️ Chưa cấu hình KNOWLEDGE_CHANNEL_ID trong Cloudflare Worker Variables.", flags: 64 } });
  const subcommand = interaction.data?.options?.[0]?.name;
  const options = interaction.data?.options?.[0]?.options || [];
  if (subcommand === "add") {
    const topic = String(options.find(option => option.name === "topic")?.value || "General").trim().slice(0, 80);
    const content = String(options.find(option => option.name === "content")?.value || "").trim();
    if (!content || content.length > 1500) return json({ type: 4, data: { content: "Nội dung phải có từ 1 đến 1.500 ký tự.", flags: 64 } });
    await discord(`/channels/${env.KNOWLEDGE_CHANNEL_ID}/messages`, env, { method: "POST", body: JSON.stringify({ embeds: [{ title: "POSTLAIN KNOWLEDGE", description: content, fields: [{ name: "Topic", value: topic || "General" }], footer: { text: "POSTLAIN AI · Server Knowledge" }, timestamp: new Date().toISOString() }], allowed_mentions: { parse: [] } }) });
    return json({ type: 4, data: { content: `✅ Đã lưu kiến thức **${topic || "General"}** cho POSTLAIN AI.`, flags: 64 } });
  }
  if (subcommand === "list") {
    const messages = await discord(`/channels/${env.KNOWLEDGE_CHANNEL_ID}/messages?limit=100`, env);
    const entries = messages.filter(isKnowledgeEntry).slice(0, 15);
    const lines = entries.map(message => { const topic = message.embeds[0].fields?.find(field => field.name === "Topic")?.value || "General"; return `• **${topic}** · ID: \`${message.id}\``; });
    return json({ type: 4, data: { content: lines.length ? `**POSTLAIN KNOWLEDGE · ${lines.length} mục gần nhất**\n${lines.join("\n")}` : "Chưa có kiến thức nào được lưu.", flags: 64 } });
  }
  if (subcommand === "remove") {
    const messageId = String(options.find(option => option.name === "entry_id")?.value || "").trim();
    if (!/^\d{17,20}$/.test(messageId)) return json({ type: 4, data: { content: "Entry ID không hợp lệ. Dùng /knowledge list để lấy ID.", flags: 64 } });
    const message = await discord(`/channels/${env.KNOWLEDGE_CHANNEL_ID}/messages/${messageId}`, env);
    if (!isKnowledgeEntry(message)) return json({ type: 4, data: { content: "Không tìm thấy mục kiến thức hợp lệ để xóa.", flags: 64 } });
    await discord(`/channels/${env.KNOWLEDGE_CHANNEL_ID}/messages/${messageId}`, env, { method: "DELETE" });
    return json({ type: 4, data: { content: "🗑️ Đã xóa mục kiến thức.", flags: 64 } });
  }
  return json({ type: 4, data: { content: "Lệnh kiến thức không hợp lệ.", flags: 64 } });
}

async function handleInteraction(interaction, env, ctx) {
  if (interaction.type === 1) return json({ type: 1 });

  if (interaction.type === 2) {
    const command = interaction.data?.name;
    const subcommand = interaction.data?.options?.[0]?.name;

    // AI chat command: chat-only in Phase 1, with sequential provider fallback.
    if (command === "ask") {
      if (!isAdmin(interaction)) {
        return json({ type: 4, data: { content: "⛔ POSTLAIN AI đang trong giai đoạn thử nghiệm và hiện chỉ dành cho Admin.", flags: 64 } });
      }
      const question = interaction.data?.options?.find(option => option.name === "question")?.value;
      if (typeof question !== "string" || !question.trim()) {
        return json({ type: 4, data: { content: "Hãy nhập câu hỏi cho POSTLAIN AI.", flags: 64 } });
      }
      if (question.length > 1800) {
        return json({ type: 4, data: { content: "Câu hỏi vượt quá giới hạn 1.800 ký tự.", flags: 64 } });
      }
      const deferred = json({ type: 5, data: { flags: 64 } });
      const work = (async () => {
        try {
          const knowledge = await loadKnowledge(env);
          const answer = await generateAnswer(env, question, knowledge);
          await editInteractionResponse(env, interaction, answer.slice(0, 1850));
        } catch (error) {
          console.error("POSTLAIN AI request failed:", error);
          await editInteractionResponse(env, interaction, `⚠️ ${String(error.message || "AI request failed").slice(0, 700)}`);
        }
      })();
      ctx.waitUntil(work);
      return deferred;
    }

    if (command === "knowledge") {
      try { return await handleKnowledgeCommand(interaction, env); }
      catch (error) { console.error("POSTLAIN knowledge command failed:", error); return json({ type: 4, data: { content: "⚠️ Không thể xử lý kho kiến thức. Kiểm tra quyền bot trong phòng knowledge.", flags: 64 } }); }
    }

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

    // Admin notification relay: slash command is accepted only in the admin room.
    if (command === "noti" && subcommand === "send") {
      const ADMIN_CHANNEL_ID = "1573302128351645706";
      const PUBLIC_CHANNEL_ID = "1571711139220426794";
      const sourceChannelId = interaction.channel_id;
      const permissions = BigInt(interaction.member?.permissions || "0");
      const isAdmin = (permissions & 8n) === 8n;
      if (sourceChannelId !== ADMIN_CHANNEL_ID || !isAdmin) {
        return json({ type: 4, data: { content: "⛔ Lệnh này chỉ dành cho Admin trong phòng thông báo quản trị. / Admin-only command in the admin notification room.", flags: 64 } });
      }
      const message = interaction.data?.options?.[0]?.options?.find(option => option.name === "message")?.value;
      if (typeof message !== "string" || !message.trim()) {
        return json({ type: 4, data: { content: "Vui lòng nhập nội dung thông báo. / Please provide a notification message.", flags: 64 } });
      }
      if (message.length > 2000) {
        return json({ type: 4, data: { content: "Thông báo vượt quá giới hạn 2.000 ký tự. / Message exceeds the 2,000-character limit.", flags: 64 } });
      }
      const deferred = json({ type: 5, data: { flags: 64 } });
      const work = (async () => {
        try {
          await discord(`/channels/${PUBLIC_CHANNEL_ID}/messages`, env, {
            method: "POST",
            body: JSON.stringify({ content: message, allowed_mentions: { parse: [] } })
          });
          await editInteractionResponse(env, interaction, "✅ Đã gửi thông báo đến phòng công khai. / Notification sent successfully.");
        } catch (error) {
          console.error("Notification relay failed:", error);
          await editInteractionResponse(env, interaction, "❌ Không gửi được thông báo. Kiểm tra quyền Send Messages của bot ở phòng nhận. / Could not send notification. Check the bot's Send Messages permission in the destination channel.");
        }
      })();
      ctx.waitUntil(work);
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
  }
};
