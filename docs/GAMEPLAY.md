# Game system

A small, readable game hub for the Discord server. All balances are virtual Gold. They have no cash value and cannot be purchased or withdrawn.

## Commands

| Command | What it does |
| --- | --- |
| `/daily` | Claim the daily Gold reward. |
| `/ngold` | View Gold balance, daily streak and mini-game record. |
| `/grank` | View the Gold leaderboard. |
| `/baucua animal amount` | Bet virtual Gold on one of six Bầu Cua animals. |
| `/noitu start` | Start a Vietnamese word-chain round in the configured game channel. |
| `/noitu end` | End a round (starter or administrator). |
| `/noitu score` | View the word-chain leaderboard. |
| `/nme` | View a word-chain profile. |
| `/nrank` | View the word-chain leaderboard. |
| `/them-tu` | Add a verified two-syllable phrase (administrator only). |

## Daily rewards

- The first consecutive daily claim starts at 350 Gold.
- Each consecutive day adds 50 Gold.
- The reward is capped at 1,000 Gold.
- A missed calendar day resets the streak.
- The daily calendar resets at 00:00 in Asia/Ho_Chi_Minh.
- Each Discord interaction is processed once, even if Discord retries delivery.

## Bầu Cua

- Six choices: Nai, Bầu, Gà, Cá, Cua and Tôm.
- A round rolls three independent dice.
- Bets are from 10 to 10,000 Gold and cannot exceed the current balance.
- If the chosen animal does not appear, the stake is lost.
- If it appears once, the player receives the stake plus one stake as winnings.
- If it appears twice, the player receives the stake plus two stakes as winnings.
- If it appears three times, the player receives the stake plus three stakes as winnings.
- Dice are selected with Web Crypto rejection sampling to avoid modulo bias.

## Data and reliability

Wallets, daily claims, game records and transaction receipts are stored in the existing Durable Object SQLite database. No external paid AI API is required. Existing role selector, moderation, notifications, support routing and voice commands remain separate from this game module.
