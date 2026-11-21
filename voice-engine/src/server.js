import http from "node:http";
import { spawn } from "node:child_process";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import {
  Client,
  GatewayIntentBits,
  Events,
  ChannelType,
  PermissionFlagsBits
} from "discord.js";
import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel
} from "@discordjs/voice";

const PORT = Number(process.env.PORT || 3000);
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const SECRET = process.env.VOICE_ENGINE_SECRET;
const TEMP_DIR = process.env.TTS_TEMP_DIR || os.tmpdir();
const MAX_TEXT = 1200;
const MAX_QUEUE = 3;

if (!TOKEN || !SECRET || SECRET.length < 32) {
  throw new Error("DISCORD_BOT_TOKEN and a VOICE_ENGINE_SECRET of at least 32 characters are required.");
}

const voices = {
  vi: { male: "vi-VN-NamMinhNeural", female: "vi-VN-HoaiMyNeural" },
  en: { male: "en-US-GuyNeural", female: "en-US-AriaNeural" },
  ja: { male: "ja-JP-KeitaNeural", female: "ja-JP-NanamiNeural" },
  ko: { male: "ko-KR-InJoonNeural", female: "ko-KR-SunHiNeural" },
  zh: { male: "zh-CN-YunxiNeural", female: "zh-CN-XiaoxiaoNeural" },
  es: { male: "es-ES-AlvaroNeural", female: "es-ES-ElviraNeural" },
  fr: { male: "fr-FR-HenriNeural", female: "fr-FR-DeniseNeural" },
  de: { male: "de-DE-ConradNeural", female: "de-DE-KatjaNeural" },
  it: { male: "it-IT-DiegoNeural", female: "it-IT-ElsaNeural" },
  pt: { male: "pt-BR-AntonioNeural", female: "pt-BR-FranciscaNeural" },
  id: { male: "id-ID-ArdiNeural", female: "id-ID-GadisNeural" },
  th: { male: "th-TH-NiwatNeural", female: "th-TH-PremwadeeNeural" }
};

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
});
const sessions = new Map();
const queues = new Map();

function send(res, status, data) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

function authorized(req) {
  const header = req.headers.authorization || "";
  const supplied = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
  const expected = Buffer.from(SECRET);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10000) throw new Error("Request body too large.");
  }
  return raw ? JSON.parse(raw) : {};
}

async function memberVoice(guildId, userId) {
  const guild = await client.guilds.fetch(guildId);
  let member = guild.members.cache.get(userId);
  if (!member) member = await guild.members.fetch(userId);
  const channel = member.voice.channel;
  if (!channel || channel.type !== ChannelType.GuildVoice) {
    throw new Error("Mày phải vào một voice channel trước rồi mới gọi bot.");
  }
  return { guild, member, channel };
}

async function getOrJoin(guildId, userId) {
  const { guild, channel } = await memberVoice(guildId, userId);
  let session = sessions.get(guildId);
  if (session && session.channelId !== channel.id) {
    if (session.player.state.status !== AudioPlayerStatus.Idle) {
      throw new Error("Bot đang phát âm thanh ở voice channel khác. Dùng /leave trước nhé.");
    }
    session.connection.destroy();
    sessions.delete(guildId);
    session = null;
  }
  if (session) return session;

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: true
  });
  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
  connection.subscribe(player);
  session = { connection, player, channelId: channel.id, channelName: channel.name, joinedBy: userId };
  sessions.set(guildId, session);

  connection.on(VoiceConnectionStatus.Disconnected, () => {
    if (sessions.get(guildId)?.connection === connection) {
      setTimeout(() => {
        if (connection.state.status === VoiceConnectionStatus.Disconnected) {
          connection.destroy();
          sessions.delete(guildId);
        }
      }, 5000).unref?.();
    }
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20000);
  } catch {
    connection.destroy();
    sessions.delete(guildId);
    throw new Error("Không kết nối được voice Discord. Kiểm tra quyền Connect/Speak và mạng UDP của máy chủ.");
  }
  return session;
}

async function synthesize(text, voice) {
  const folder = await mkdtemp(path.join(TEMP_DIR, "pl-"));
  const output = path.join(folder, "speech.mp3");
  try {
    await new Promise((resolve, reject) => {
      const child = spawn("python3", [
        "-m", "edge_tts",
        "--voice", voice,
        "--text", text,
        "--write-media", output
      ], { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", chunk => { stderr += chunk.toString().slice(0, 1000); });
      child.once("error", reject);
      child.once("close", code => code === 0 ? resolve() : reject(new Error("TTS synthesis failed: " + stderr.slice(0, 300))));
    });
    return { folder, output };
  } catch (error) {
    await rm(folder, { recursive: true, force: true });
    throw error;
  }
}

async function playSpeech(session, text, voice) {
  const audio = await synthesize(text, voice);
  const ffmpeg = spawn("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-i", audio.output,
    "-f", "s16le", "-ar", "48000", "-ac", "2", "pipe:1"
  ], { stdio: ["ignore", "pipe", "pipe"] });

  try {
    const resource = createAudioResource(ffmpeg.stdout, { inputType: StreamType.Raw });
    const finished = new Promise((resolve, reject) => {
      const onIdle = () => { cleanup(); resolve(); };
      const onError = error => { cleanup(); reject(error); };
      const cleanup = () => {
        session.player.off(AudioPlayerStatus.Idle, onIdle);
        session.player.off("error", onError);
      };
      session.player.once(AudioPlayerStatus.Idle, onIdle);
      session.player.once("error", onError);
    });
    ffmpeg.once("error", error => console.error("FFmpeg process error:", error));
    session.player.play(resource);
    await finished;
  } finally {
    ffmpeg.kill("SIGKILL");
    await rm(audio.folder, { recursive: true, force: true });
  }
}

function enqueue(guildId, job) {
  const queue = queues.get(guildId) || [];
  if (queue.length >= MAX_QUEUE) throw new Error("Hàng chờ đọc thoại đã đầy. Chờ bot đọc xong rồi thử lại.");
  queue.push(job);
  queues.set(guildId, queue);
  if (queue.length === 1) void drainQueue(guildId);
}

async function drainQueue(guildId) {
  const queue = queues.get(guildId);
  while (queue?.length) {
    const job = queue[0];
    try {
      const session = sessions.get(guildId);
      if (!session) throw new Error("Bot đã rời voice channel.");
      await playSpeech(session, job.text, job.voice);
    } catch (error) {
      console.error("Voice playback failed:", error);
    }
    queue.shift();
  }
  queues.delete(guildId);
}

async function handle(req, res) {
  if (req.method === "GET" && req.url === "/health") {
    return send(res, 200, { ok: true, service: "postlain-voice-engine", discordReady: client.isReady() });
  }
  if (req.method !== "POST") return send(res, 404, { error: "Not found" });
  if (!authorized(req)) return send(res, 401, { error: "Unauthorized" });

  let body;
  try { body = await readBody(req); }
  catch (error) { return send(res, 400, { error: error.message || "Invalid JSON" }); }

  const guildId = String(body.guildId || "");
  const userId = String(body.userId || "");
  if (!/^\d{17,20}$/.test(guildId) || !/^\d{17,20}$/.test(userId)) {
    return send(res, 400, { error: "Invalid guild or user ID." });
  }
  if (!client.isReady()) return send(res, 503, { error: "Discord voice client is still connecting." });

  try {
    if (req.url === "/join") {
      const session = await getOrJoin(guildId, userId);
      return send(res, 200, { ok: true, message: "🔊 POSTLAIN đã vào voice channel **" + session.channelName + "**." });
    }

    if (req.url === "/leave") {
      const session = sessions.get(guildId);
      if (!session) return send(res, 200, { ok: true, message: "Bot hiện không ở trong voice channel." });
      const { member } = await memberVoice(guildId, userId).catch(async () => {
        const guild = await client.guilds.fetch(guildId);
        return { member: await guild.members.fetch(userId) };
      });
      const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
      if (!isAdmin && member.voice.channelId !== session.channelId) {
        throw new Error("Chỉ Admin hoặc người đang ở cùng voice channel mới có thể gọi bot rời phòng.");
      }
      session.player.stop(true);
      session.connection.destroy();
      sessions.delete(guildId);
      queues.delete(guildId);
      return send(res, 200, { ok: true, message: "👋 POSTLAIN đã rời voice channel." });
    }

    if (req.url === "/speak") {
      const text = String(body.text || "").trim();
      const language = String(body.language || "vi");
      const gender = String(body.gender || "female");
      if (!text || text.length > MAX_TEXT) throw new Error("Nội dung phải có từ 1 đến 1.200 ký tự.");
      if (!voices[language] || !["male", "female"].includes(gender)) throw new Error("Ngôn ngữ hoặc giọng đọc không được hỗ trợ.");
      const session = await getOrJoin(guildId, userId);
      if (session.channelId !== (await memberVoice(guildId, userId)).channel.id) {
        throw new Error("Mày phải ở cùng voice channel với bot.");
      }
      const voice = voices[language][gender];
      enqueue(guildId, { text, voice });
      return send(res, 202, { ok: true, message: "🗣️ Đã thêm vào hàng chờ. Giọng **" + language.toUpperCase() + " / " + gender + "** sẽ đọc ngay khi tới lượt." });
    }

    if (req.url === "/stop") {
      const session = sessions.get(guildId);
      if (!session) return send(res, 200, { ok: true, message: "Bot không phát âm thanh." });
      const { member } = await memberVoice(guildId, userId);
      const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
      if (!isAdmin && member.voice.channelId !== session.channelId) throw new Error("Mày phải ở cùng voice channel với bot để dừng phát.");
      session.player.stop(true);
      queues.delete(guildId);
      return send(res, 200, { ok: true, message: "⏹️ Đã dừng phát âm thanh và xóa hàng chờ." });
    }

    if (req.url === "/status") {
      const session = sessions.get(guildId);
      const queue = queues.get(guildId) || [];
      return send(res, 200, {
        ok: true,
        message: session
          ? "🔊 POSTLAIN đang ở **" + session.channelName + "** · hàng chờ: " + queue.length
          : "POSTLAIN hiện chưa tham gia voice channel."
      });
    }

    return send(res, 404, { error: "Unknown voice action." });
  } catch (error) {
    return send(res, 400, { error: String(error?.message || error).slice(0, 500) });
  }
}

const server = http.createServer((req, res) => {
  void handle(req, res).catch(error => {
    console.error("Voice Engine request failed:", error);
    if (!res.headersSent) send(res, 500, { error: "Internal Voice Engine error." });
    else res.destroy();
  });
});

server.listen(PORT, "0.0.0.0", () => console.log("POSTLAIN Voice Engine listening on", PORT));

client.once(Events.ClientReady, readyClient => {
  console.log("POSTLAIN Voice Engine Discord-ready as", readyClient.user.tag);
});
client.on("error", error => console.error("Discord client error:", error));
await client.login(TOKEN);
