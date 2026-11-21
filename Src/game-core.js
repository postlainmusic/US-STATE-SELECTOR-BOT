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
