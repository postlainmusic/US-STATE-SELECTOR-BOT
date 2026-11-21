export const BAU_CUA_ANIMALS = Object.freeze([
  { value: "nai", label: "Nai", emoji: "🦌" },
  { value: "bau", label: "Bầu", emoji: "🍐" },
  { value: "ga", label: "Gà", emoji: "🐓" },
  { value: "ca", label: "Cá", emoji: "🐟" },
  { value: "cua", label: "Cua", emoji: "🦀" },
  { value: "tom", label: "Tôm", emoji: "🦐" }
]);

export function getVietnamDateKey(timestamp = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return values.year + "-" + values.month + "-" + values.day;
}

export function getDailyReward(streak) {
  const safeStreak = Math.max(1, Math.floor(Number(streak) || 1));
  return Math.min(1000, 350 + (safeStreak - 1) * 50);
}

export function calculateBauCuaResult({ animal, amount, dice }) {
  const selected = BAU_CUA_ANIMALS.find(item => item.value === String(animal));
  const bet = Number(amount);
  if (!selected) return { ok: false, code: "invalid_animal" };
  if (!Number.isSafeInteger(bet) || bet < 10 || bet > 10000) {
    return { ok: false, code: "invalid_amount" };
  }
  if (!Array.isArray(dice) || dice.length !== 3 || dice.some(value => !BAU_CUA_ANIMALS.some(item => item.value === value))) {
    return { ok: false, code: "invalid_dice" };
  }
  const matches = dice.filter(value => value === selected.value).length;
  const payout = matches ? bet * (matches + 1) : 0;
  return { ok: true, animal: selected, amount: bet, dice: [...dice], matches, payout, net: payout - bet };
}

export function getRankLabel(rank) {
  const n = Number(rank);
  if (!Number.isInteger(n) || n < 1) return "Chưa xếp hạng";
  return "#" + n;
}

export function buildWordChainReplyIndex(dictionary) {
  const buckets = new Map();
  for (const value of dictionary || []) {
    const phrase = String(value || "").normalize("NFC").toLocaleLowerCase("vi-VN").trim().replace(/\s+/gu, " ");
    const parts = phrase.split(" ");
    if (parts.length !== 2 || parts.some(part => !/^\p{L}+$/u.test(part))) continue;
    if (!buckets.has(parts[0])) buckets.set(parts[0], new Set());
    buckets.get(parts[0]).add(phrase);
  }
  return new Map([...buckets].map(([first, phrases]) => [first, [...phrases]]));
}

export function chooseWordChainReply(index, currentTail, usedWords = [], randomValue = Math.random()) {
  const used = usedWords instanceof Set ? usedWords : new Set(usedWords);
  const candidates = (index.get(String(currentTail || "")) || []).filter(phrase => !used.has(phrase));
  if (!candidates.length) return null;
  const safeRandom = Math.max(0, Math.min(0.999999999, Number(randomValue) || 0));
  return candidates[Math.floor(safeRandom * candidates.length)];
}

export const XUXI_CHOICES = Object.freeze([
  { value: "bua", label: "Búa", emoji: "🪨", beats: "keo" },
  { value: "keo", label: "Kéo", emoji: "✂️", beats: "bao" },
  { value: "bao", label: "Bao", emoji: "📄", beats: "bua" }
]);

export function resolveXuxi({ choice, botChoice, amount = 0 }) {
  const player = XUXI_CHOICES.find(item => item.value === String(choice));
  const bot = XUXI_CHOICES.find(item => item.value === String(botChoice));
  const bet = Number(amount);
  if (!player || !bot) return { ok: false, code: "invalid_choice" };
  if (!Number.isSafeInteger(bet) || bet < 0 || bet > 10000) return { ok: false, code: "invalid_amount" };
  const outcome = player.value === bot.value ? "tie" : player.beats === bot.value ? "win" : "loss";
  const net = outcome === "win" ? bet : outcome === "loss" ? -bet : 0;
  return { ok: true, player, bot, amount: bet, outcome, net };
}
