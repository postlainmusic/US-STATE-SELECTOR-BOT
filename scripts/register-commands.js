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
      options: [
        {
          type: 7,
          name: "channel",
          description: "Choose the destination text channel / Chọn phòng nhận",
          required: true,
          channel_types: [0, 5]
        },
        {
          type: 3,
          name: "message",
          description: "Notification text / Nội dung thông báo",
          required: true,
          max_length: 2000
        }
      ]
    }]
  },
  {
    name: "noitu",
    description: "Play Vietnamese word chain in the dedicated game room",
    dm_permission: false,
    options: [
      { type: 1, name: "start", description: "Start a new Vietnamese word-chain game" },
      { type: 1, name: "end", description: "End the current game (starter or admin)" },
      { type: 1, name: "score", description: "Show the word-chain leaderboard" }
    ]
  },
  {
    name: "coinflip",
    description: "Flip a coin",
    dm_permission: false
  },
  {
    name: "roll",
    description: "Roll a dice",
    dm_permission: false,
    options: [{
      type: 4,
      name: "sides",
      description: "Number of dice sides (2-1000, default 6)",
      required: false,
      min_value: 2,
      max_value: 1000
    }]
  },
  {
    name: "choose",
    description: "Choose randomly from a list of options",
    dm_permission: false,
    options: [{
      type: 3,
      name: "options",
      description: "Options separated by commas",
      required: true
    }]
  },
  {
    name: "help",
    description: "Show the POSTLAIN community bot guide",
    dm_permission: false
  },
  {
    name: "ping",
    description: "Check whether POSTLAIN is responding",
    dm_permission: false
  },
  {
    name: "serverinfo",
    description: "Show server information",
    dm_permission: false
  },
  {
    name: "userinfo",
    description: "View a member profile",
    dm_permission: false,
    options: [{
      type: 6,
      name: "user",
      description: "Member to look up",
      required: false
    }]
  },
  {
    name: "avatar",
    description: "Show a member's avatar",
    dm_permission: false,
    options: [{
      type: 6,
      name: "user",
      description: "Member whose avatar you want to see",
      required: false
    }]
  },
  {
    name: "report",
    description: "Send a private report to the Staff team",
    dm_permission: false,
    options: [{
      type: 1,
      name: "send",
      description: "Submit a report / Gửi báo cáo",
      options: [{
        type: 3,
        name: "details",
        description: "Describe the issue. Do not include passwords or login codes.",
        required: true
      }]
    }]
  },
  {
    name: "poll",
    description: "Create a community poll",
    dm_permission: false,
    options: [{
      type: 1,
      name: "create",
      description: "Create a yes/no/community poll",
      options: [{
        type: 3,
        name: "question",
        description: "Question (up to 240 characters)",
        required: true
      }]
    }]
  },
  {
    name: "purge",
    description: "Delete recent messages in this channel",
    default_member_permissions: "8192",
    dm_permission: false,
    options: [{
      type: 4,
      name: "amount",
      description: "Number of recent messages to delete (2-100)",
      required: true,
      min_value: 2,
      max_value: 100
    }]
  },
  {
    name: "slowmode",
    description: "Set this channel's slowmode",
    default_member_permissions: "16",
    dm_permission: false,
    options: [{
      type: 4,
      name: "seconds",
      description: "Seconds between messages (0-21600, 0 disables)",
      required: true,
      min_value: 0,
      max_value: 21600
    }]
  },
  {
    name: "lock",
    description: "Lock @everyone from sending messages in this channel",
    default_member_permissions: "268435456",
    dm_permission: false
  },
  {
    name: "unlock",
    description: "Restore @everyone message access in this channel",
    default_member_permissions: "268435456",
    dm_permission: false
  },

  {
    name: "join",
    description: "Join your current voice channel",
    dm_permission: false
  },
  {
    name: "leave",
    description: "Leave the current voice channel",
    dm_permission: false
  },
  {
    name: "speak",
    description: "Read text aloud in your voice channel",
    dm_permission: false,
    options: [
      { type: 3, name: "text", description: "Text for POSTLAIN to read (up to 1,200 characters)", required: true, max_length: 1200 },
      { type: 3, name: "language", description: "Spoken language", required: true, choices: [{ name: "Vietnamese", value: "vi" },
          { name: "English", value: "en" },
          { name: "Japanese", value: "ja" },
          { name: "Korean", value: "ko" },
          { name: "Chinese", value: "zh" },
          { name: "Spanish", value: "es" },
          { name: "French", value: "fr" },
          { name: "German", value: "de" },
          { name: "Italian", value: "it" },
          { name: "Portuguese", value: "pt" },
          { name: "Indonesian", value: "id" },
          { name: "Thai", value: "th" }] },
      { type: 3, name: "gender", description: "Voice gender", required: true, choices: [{ name: "Female", value: "female" }, { name: "Male", value: "male" }] }
    ]
  },
  {
    name: "voice",
    description: "Control POSTLAIN Voice Assistant",
    dm_permission: false,
    options: [
      { type: 1, name: "status", description: "Show voice connection and playback queue" },
      { type: 1, name: "stop", description: "Stop playback and clear the queue" }
    ]
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
