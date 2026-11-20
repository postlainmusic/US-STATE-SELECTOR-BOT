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
        "**CHOOSE YOUR TERRITORY. REPRESENT YOUR STATE.**\\n" +
        "Select one U.S. state to display on your profile.\\n\\n" +
        "```ansi\\n\\u001b[1;34m  50 STATES  /  04 REGIONS  /  01 SELECTION\\u001b[0m\\n```" +
        "**01  /  NORTHEAST**  ·  9 states\\n" +
        "**02  /  MIDWEST**  ·  12 states\\n" +
        "**03  /  SOUTH**  ·  16 states\\n" +
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

async function handleInteraction(interaction, env, ctx) {
  if (interaction.type === 1) return json({ type: 1 });

  if (interaction.type === 2) {
    const command = interaction.data?.name;
    const subcommand = interaction.data?.options?.[0]?.name;
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
        await editInteractionResponse(env, interaction, `Could not update your state role. Please contact a moderator.\\n\\`${String(error.message).slice(0, 250)}\\``);
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
