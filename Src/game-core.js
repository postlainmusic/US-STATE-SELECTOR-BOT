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

export function getDailyReward(_streak) {
  return 100000;
}

export function rollBauCuaDice(animal, random = Math.random) {
  const selected = BAU_CUA_ANIMALS.find(item => item.value === String(animal));
  if (!selected) return null;
  const wins = Number(random()) < 0.48;
  const others = BAU_CUA_ANIMALS.filter(item => item.value !== selected.value);
  const dice = [];
  if (wins) {
    const hitIndex = Math.floor(Math.max(0, Math.min(0.999999999, Number(random()) || 0)) * 3);
    for (let i = 0; i < 3; i++) {
      const pool = i === hitIndex ? [selected] : BAU_CUA_ANIMALS;
      dice.push(pool[Math.floor(Math.max(0, Math.min(0.999999999, Number(random()) || 0)) * pool.length)].value);
    }
    if (!dice.includes(selected.value)) dice[hitIndex] = selected.value;
  } else {
    for (let i = 0; i < 3; i++) dice.push(others[Math.floor(Math.max(0, Math.min(0.999999999, Number(random()) || 0)) * others.length)].value);
  }
  return dice;
}

export function chooseXuxiBotChoice(choice, random = Math.random) {
  const player = XUXI_CHOICES.find(item => item.value === String(choice));
  if (!player) return null;
  const playerWins = Number(random()) < 0.48;
  return playerWins
    ? XUXI_CHOICES.find(item => item.value === player.beats)
    : XUXI_CHOICES.find(item => item.beats === player.value);
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
  const payout = matches ? bet * 2 : 0;
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
  if (!Number.isSafeInteger(bet) || bet < 10 || bet > 10000) return { ok: false, code: "invalid_amount" };
  const outcome = player.value === bot.value ? "tie" : player.beats === bot.value ? "win" : "loss";
  const net = outcome === "win" ? bet : outcome === "loss" ? -bet : 0;
  return { ok: true, player, bot, amount: bet, outcome, net };
}
