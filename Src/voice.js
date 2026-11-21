const API = "https://discord.com/api/v10";

function response(content) {
  return new Response(JSON.stringify({ type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] } } }), {
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function getOption(interaction, name) {
  const options = interaction.data?.options || [];
  for (const option of options) {
    if (option.name === name) return option.value;
    const nested = option.options?.find(item => item.name === name);
    if (nested) return nested.value;
  }
  return undefined;
}

async function editOriginal(env, interaction, content) {
  const url = `${API}/webhooks/${env.DISCORD_APPLICATION_ID}/${interaction.token}/messages/@original`;
  const result = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } })
  });
  if (!result.ok) console.error("Voice interaction response update failed:", result.status, (await result.text()).slice(0, 300));
}

async function callVoiceEngine(env, route, payload) {
  const base = String(env.VOICE_ENGINE_URL || "").replace(/\/+$/, "");
  if (!base || !env.VOICE_ENGINE_SECRET) throw new Error("Voice Engine chưa được cấu hình. Cần hoàn tất máy chủ voice miễn phí và Cloudflare Tunnel trước.");
  const result = await fetch(base + route, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + env.VOICE_ENGINE_SECRET,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000)
  });
  const data = await result.json().catch(() => ({}));
  if (!result.ok) throw new Error(data.error || `Voice Engine trả về HTTP ${result.status}`);
  return data;
}

export async function handleVoiceCommand(interaction, env, ctx) {
  const command = interaction.data?.name;
  if (!["join", "leave", "speak", "voice"].includes(command)) return null;
  if (!interaction.guild_id) return response("Lệnh Voice chỉ dùng bên trong server Discord.");

  const userId = interaction.member?.user?.id || interaction.user?.id;
  if (!userId) return response("Không xác định được tài khoản của mày.");

  let route;
  const payload = { guildId: interaction.guild_id, userId };

  if (command === "join") route = "/join";
  else if (command === "leave") route = "/leave";
  else if (command === "speak") {
    route = "/speak";
    payload.text = String(getOption(interaction, "text") || "").trim();
    payload.language = String(getOption(interaction, "language") || "vi");
    payload.gender = String(getOption(interaction, "gender") || "female");
    if (!payload.text) return response("Nhập nội dung cần đọc.");
    if (payload.text.length > 1200) return response("Mỗi lượt đọc tối đa 1.200 ký tự để tránh chiếm voice quá lâu.");
  } else {
    const subcommand = interaction.data?.options?.[0]?.name;
    if (subcommand === "stop") route = "/stop";
    else if (subcommand === "status") route = "/status";
    else return response("Lệnh Voice không hợp lệ.");
  }

  const deferred = new Response(JSON.stringify({ type: 5, data: { flags: 64 } }), {
    headers: { "content-type": "application/json; charset=utf-8" }
  });
  ctx.waitUntil((async () => {
    try {
      const result = await callVoiceEngine(env, route, payload);
      await editOriginal(env, interaction, result.message || "✅ Voice command completed.");
    } catch (error) {
      console.error("POSTLAIN Voice command failed:", String(error?.message || error));
      await editOriginal(env, interaction, "🔊 " + String(error?.message || "Voice Engine chưa phản hồi.").slice(0, 1500));
    }
  })());
  return deferred;
}
