# POSTLAIN AI Phase 3A: Gateway and rolling community memory

## What this phase adds

- A Discord Gateway connection hosted by a Cloudflare Durable Object.
- Message ingestion for the configured guild, limited to channels the bot can view.
- Automatic exclusion of the Staff Chat and Mod Logs channel IDs.
- Additional exclusions for channel/category names containing private-room markers, and the curated knowledge channel.
- Default-deny classification: unknown channels are not ingested until the bot can classify them.
- A rolling context window for `/ask` and direct bot mentions.
- Direct replies when a member mentions POSTLAIN AI.
- Message retention: at most 7 days, with a hard cap of 1,500 stored messages.
- Session resume, heartbeat ACK handling, scheduled reconnection, and a 13-minute connection rotation.

## Required Cloudflare bindings and secrets

Existing secrets remain unchanged:
- `DISCORD_BOT_TOKEN`
- `DISCORD_APPLICATION_ID`
- `GEMINI_API_KEY` and/or `OPENROUTER_API_KEY`

The Wrangler configuration declares:
- Durable Object binding `GATEWAY`
- SQLite-backed Durable Object class `DiscordGateway`
- Guild ID `1571711138482233445`
- Excluded channel IDs `1571762668916707399,1571762812886192178`
- A five-minute Cron Trigger to ensure the Gateway is connected

The bot needs View Channel and Read Message History permissions in community rooms. It does not need Presence Intent. Message Content and Server Members intents must be enabled in the Developer Portal.

## Privacy and safety

- Staff Chat, Mod Logs, and the knowledge-storage channel are never ingested.
- Private-looking channel/category names are excluded. Unknown channels are excluded until classified.
- The bot ignores its own messages and webhook messages.
- Stored context is temporary, not a personal profile. It stores display name, channel name, message text, and timestamp, without storing the member's Discord user ID.
- Conversation context expires after 7 days and is capped at 1,500 messages.
- Recent conversation content may be sent to the configured AI provider when a member asks a question or mentions the bot.
- This phase does not perform moderation, role changes, channel management, or other privileged server actions.
- Automatic welcome messages are not enabled until a public welcome channel is configured.

Before merging and deploying, the public notice should also state the 7-day temporary context retention period.
