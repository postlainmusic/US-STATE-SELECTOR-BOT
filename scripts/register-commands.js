const appId = process.env.DISCORD_APPLICATION_ID;
const botToken = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;

if (!appId || !botToken || !guildId) {
  console.error("Set DISCORD_APPLICATION_ID, DISCORD_BOT_TOKEN and DISCORD_GUILD_ID.");
  process.exit(1);
}

const commands = [
  {
    name: "game",
    description: "Mở bảng chọn trò chơi POSTLAIN",
    dm_permission: false
  },
  {
    name: "gamepanel",
    description: "Đăng bảng chọn trò chơi POSTLAIN",
    default_member_permissions: "8",
    dm_permission: false,
    options: [{ type: 1, name: "publish", description: "Đăng Game Hub vào kênh hiện tại" }]
  },
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
    name: "nme",
    description: "View your word-chain profile",
    dm_permission: false,
    options: [{
      type: 6,
      name: "user",
      description: "View another player's profile",
      required: false
    }]
  },
  {
    name: "nrank",
    description: "Show the top 20 word-chain players",
    dm_permission: false
  },
  {
    name: "de-xuat-tu",
    description: "Đề xuất cụm từ còn thiếu trong từ điển nối từ",
    dm_permission: false,
    options: [{
      type: 3,
      name: "word",
      description: "Cụm tiếng Việt gồm đúng 2 tiếng",
      required: true,
      max_length: 80
    }]
  },
  {
    name: "tu-cho-duyet",
    description: "Xem danh sách cụm từ đang chờ Admin duyệt",
    default_member_permissions: "8",
    dm_permission: false
  },
  {
    name: "duyet-tu",
    description: "Duyệt một đề xuất từ (Admin)",
    default_member_permissions: "8",
    dm_permission: false,
    options: [{
      type: 4,
      name: "id",
      description: "Mã đề xuất",
      required: true,
      min_value: 1
    }]
  },
  {
    name: "tu-choi-tu",
    description: "Từ chối một đề xuất từ (Admin)",
    default_member_permissions: "8",
    dm_permission: false,
    options: [{
      type: 4,
      name: "id",
      description: "Mã đề xuất",
      required: true,
      min_value: 1
    }]
  },
  {
    name: "them-tu",
    description: "Add an exact two-syllable phrase to the curated dictionary (Admin)",
    default_member_permissions: "8",
    dm_permission: false,
    options: [{
      type: 3,
      name: "word",
      description: "Vietnamese phrase with exactly two syllables",
      required: true,
      max_length: 80
    }]
  },
  {
    name: "money",
    description: "Cộng Gold cho thành viên (Admin)",
    default_member_permissions: "8",
    dm_permission: false,
    options: [
      { type: 6, name: "user", description: "Thành viên nhận Gold", required: true },
      { type: 4, name: "amount", description: "Số Gold cần cộng", required: true, min_value: 1, max_value: 1000000000 }
    ]
  },
  {
    name: "daily",
    description: "Nhận 100.000 Gold mỗi ngày",
    dm_permission: false
  },
  {
    name: "ngold",
    description: "Xem số dư và thống kê Gold",
    dm_permission: false
  },
  {
    name: "grank",
    description: "Xem bảng xếp hạng Gold",
    dm_permission: false
  },
  {
    name: "mayman",
    description: "Thử vận may với tỷ lệ thắng 48%",
    dm_permission: false,
    options: [{
      type: 4,
      name: "amount",
      description: "Gold cược (10-10.000)",
      required: true,
      min_value: 10,
      max_value: 10000
    }]
  },
  {
    name: "baucua",
    description: "Chơi Bầu Cua bằng Gold ảo",
    dm_permission: false,
    options: [
      {
        type: 3,
        name: "animal",
        description: "Chọn một cửa",
        required: true,
        choices: [
          { name: "Nai", value: "nai" },
          { name: "Bầu", value: "bau" },
          { name: "Gà", value: "ga" },
          { name: "Cá", value: "ca" },
          { name: "Cua", value: "cua" },
          { name: "Tôm", value: "tom" }
        ]
      },
      {
        type: 4,
        name: "amount",
        description: "Số Gold đặt cược (10-10.000)",
        required: true,
        min_value: 10,
        max_value: 10000
      }
    ]
  },
  {
    name: "xu-xi",
    description: "Chơi kéo búa bao với bot, có thể cược Gold",
    dm_permission: false,
    options: [
      {
        type: 3,
        name: "choice",
        description: "Chọn nước đi",
        required: true,
        choices: [
          { name: "Búa", value: "bua" },
          { name: "Kéo", value: "keo" },
          { name: "Bao", value: "bao" }
        ]
      },
      {
        type: 4,
        name: "amount",
        description: "Gold cược (10-10.000)",
        required: true,
        min_value: 10,
        max_value: 10000
      }
    ]
  },
  {
    name: "vtv",
    description: "Chơi đố vui Vua Tiếng Việt",
    dm_permission: false
  },
  {
    name: "vtvrank",
    description: "Xem bảng xếp hạng Vua Tiếng Việt",
    dm_permission: false
  },
  {
    name: "ncf",
    description: "Tung đồng xu",
    dm_permission: false
  },
  {
    name: "ntxx",
    description: "Tung xúc xắc",
    dm_permission: false,
    options: [{
      type: 4,
      name: "sides",
      description: "Số mặt xúc xắc (2-1000, mặc định 6)",
      required: false,
      min_value: 2,
      max_value: 1000
    }]
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
    name: "nserver",
    description: "Xem thông tin máy chủ",
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
