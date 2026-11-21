const appId = process.env.DISCORD_APPLICATION_ID;
const botToken = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;

if (!appId || !botToken || !guildId) {
  console.error("Set DISCORD_APPLICATION_ID, DISCORD_BOT_TOKEN and DISCORD_GUILD_ID.");
  process.exit(1);
}

const commands = [
  {
    name: "statepanel",
    description: "Publish the U.S. State Selector panel",
    default_member_permissions: "268435456",
    dm_permission: false,
    options: [{
      type: 1,
      name: "publish",
      description: "Publish the State Selector panel in this channel"
    }]
  },
  {
    name: "ask",
    description: "Ask POSTLAIN AI a question",
    dm_permission: false,
    options: [{
      type: 3,
      name: "question",
      description: "Your question for POSTLAIN AI",
      required: true
    }]
  },
  {
    name: "knowledge",
    description: "Manage POSTLAIN AI server knowledge",
    dm_permission: false,
    options: [
      { type: 1, name: "add", description: "Add server knowledge", options: [
        { type: 3, name: "topic", description: "Knowledge topic", required: true },
        { type: 3, name: "content", description: "Knowledge content (max 1500 characters)", required: true }
      ] },
      { type: 1, name: "list", description: "List saved knowledge entries" },
      { type: 1, name: "remove", description: "Remove a knowledge entry", options: [
        { type: 3, name: "entry_id", description: "Message ID from /knowledge list", required: true }
      ] }
    ]
  },
  {
    name: "feedback",
    description: "Submit feedback to the admin team",
    dm_permission: false,
    options: [{
      type: 1,
      name: "send",
      description: "Send feedback / Gửi góp ý",
      options: [{
        type: 3,
        name: "message",
        description: "Your feedback / Nội dung góp ý",
        required: true
      }]
    }]
  },
  {
    name: "noti",
    description: "Send an admin notification to the community",
    default_member_permissions: "8",
    dm_permission: false,
    options: [{
      type: 1,
      name: "send",
      description: "Send a notification / Gửi thông báo",
      options: [{
        type: 3,
        name: "message",
        description: "Notification text / Nội dung thông báo",
        required: true
      }]
    }]
  }
];

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
