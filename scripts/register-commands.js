const appId = process.env.DISCORD_APPLICATION_ID;
const botToken = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;

if (!appId || !botToken || !guildId) {
  console.error("Set DISCORD_APPLICATION_ID, DISCORD_BOT_TOKEN and DISCORD_GUILD_ID.");
  process.exit(1);
}

const commands = [{
  name: "statepanel",
  description: "Publish the U.S. State Selector panel",
  default_member_permissions: "268435456",
  dm_permission: false,
  options: [{
    type: 1,
    name: "publish",
    description: "Publish the State Selector panel in this channel"
  }]
}];

const endpoint = `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`;
const response = await fetch(endpoint, {
  method: "PUT",
  headers: {
    Authorization: `Bot ${botToken}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify(commands)
});
const body = await response.text();
if (!response.ok) {
  console.error(`Command registration failed (${response.status}): ${body}`);
  process.exit(1);
}
console.log("Registered guild command(s):");
console.log(body);
