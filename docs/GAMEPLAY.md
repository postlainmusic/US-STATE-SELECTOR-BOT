# Game system

A small, readable game hub for the Discord server. All balances are virtual Gold. They have no cash value and cannot be purchased or withdrawn.

## Commands

| Command | What it does |
| --- | --- |
| `/daily` | Claim the daily Gold reward. |
| `/ngold` | View Gold balance, daily streak and mini-game record. |
| `/grank` | View the Gold leaderboard. |
| `/baucua animal amount` | Bet virtual Gold on one of six Bầu Cua animals. |\n| `/xu-xi choice amount` | Play rock-paper-scissors against the bot, optionally betting Gold. |\n| `/vtv` | Start a multiple-choice Vietnamese language quiz. The first correct answer wins the round. |\n| `/vtvrank` | View the Vietnamese quiz leaderboard. |\n| `/nserver` | View server information. |\n| `/ncf` / `/ntxx` | Coin flip and dice roll aliases. |
| `/noitu start` | Start a Vietnamese word-chain round in the configured game channel. A valid phrase also starts a round automatically. |
| `/noitu end` | End a round (starter or administrator). |
| `/noitu score` | View the word-chain leaderboard. |
| `/nme` | View a combined player profile: word chain, Gold, mini-games and quiz stats. |
| `/nrank` | View the word-chain leaderboard. |
| `/de-xuat-tu` | Suggest a missing two-syllable phrase for review. |\n| `/duyet-tu` / `/tu-choi-tu` | Review a community suggestion (administrator only). |\n| `/them-tu` | Add a verified two-syllable phrase (administrator only). |

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

## Word-chain opponent

- The game alternates between a member and the bot: member phrase → bot phrase → next member phrase. A valid phrase also starts a round automatically; `start!` and `stop!` are available in the game room.
- Every accepted move is exactly two syllables and must connect to the final syllable of the previous move.
- The bot chooses a non-repeated reply from the bundled Vietnamese phrase datasets. It does not call a paid AI model.
- If the bot has no unused dictionary reply, the member who made the last valid move wins.
- If a member submits a phrase missing from the accepted data, the message is removed and the member receives a private explanation. They can use `/de-xuat-tu`; an administrator reviews it before acceptance.
- A wrong chain or repeated phrase loses the current round. The 30-second timer remains active.
- Dictionary matching is evidence-based, not a claim that a finite corpus contains every valid Vietnamese proper noun or colloquial phrase.

## Xù Xì

- Choose Búa, Kéo or Bao against the bot.
- The command is free when the Gold amount is 0.
- An optional 1:1 virtual Gold wager is supported, from 0 to 10,000 Gold.
- A win earns the same amount as profit, a loss deducts the stake, and a tie returns the stake.

## Vua Tiếng Việt

- A question appears with four answer buttons.
- The first correct answer closes the round and earns one point.
- Incorrect answers remain available for another attempt.
- Scores and attempts are saved in Durable Object SQLite.
- The question bank is a curated starter set and can be expanded independently.
