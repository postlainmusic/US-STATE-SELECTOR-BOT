# Discord State Selector Bot

A serverless Discord interaction bot for a one-state-per-member role selector.

## UX

- Modern dark / navy / electric-blue Embed panel.
- Four regional select menus: Northeast, Midwest, South, West.
- Each menu is single-select.
- Selecting any state replaces the member's previous state role, even if it came from another regional menu.
- `REMOVE MY STATE` clears the member's state role.
- All non-state roles are preserved.
- `/statepanel publish` publishes the persistent component panel.
- Member utilities: `/help`, `/ping`, `/serverinfo`, `/userinfo`, `/avatar`, `/report send`.
- Community fun: `/poll create`, `/coinflip`, `/roll`, `/choose`.
- Moderation utilities: `/purge`, `/slowmode`, `/lock`, `/unlock` (permission-gated).
- Community workflows: `/feedback send`, `/noti send`.
- Voice Assistant: `/join`, `/leave`, `/speak`, `/voice status`, `/voice stop` with 12 languages and male/female voices.
- POSTLAIN Community Assistant detects support topics in permitted channels, responds in Vietnamese or English, asks one clarifying question, and routes safety reports to the private Staff room. Ordinary chat is ignored. New-member greetings are handled by Carl-bot.

## Architecture

Discord Interactions Endpoint and a Cloudflare Durable Object Gateway handle commands and live community messages. The Gateway uses a structured multilingual support engine with topic priorities, built-in guidance, and 15-minute support sessions. Sessions store only category and message references, never message history or message content. Members can reply `staff` during an active session to request human help. Safety reports are forwarded to the configured private Staff room. Staff, moderation, ticket and private rooms are excluded from message reading.

The optional Voice Assistant runs as a separate Node.js 22.12+ service. Cloudflare Workers continue to handle slash commands; the voice service uses discord.js and the DAVE-capable `@discordjs/voice` 0.19 line for real-time voice connections. Text-to-speech uses the Edge TTS command-line client with selectable male/female neural voices in 12 languages. The service is protected by a shared secret and should be exposed through Cloudflare Tunnel, not a public unauthenticated port.

## 1. Create the Discord application

1. Open https://discord.com/developers/applications
2. Create an application and add a Bot.
3. Copy the Application ID, Public Key, and Bot Token.
4. Invite the bot with `bot` and `applications.commands` scopes.
5. Grant the bot `Manage Roles` permission.
6. Move the bot's highest role above all 50 state roles in Server Settings → Roles.

## 2. Prepare the 50 state roles

Create or use roles with these exact names:

- Connecticut
- Maine
- Massachusetts
- New Hampshire
- New Jersey
- New York
- Pennsylvania
- Rhode Island
- Vermont
- Illinois
- Indiana
- Iowa
- Kansas
- Michigan
- Minnesota
- Missouri
- Nebraska
- North Dakota
- Ohio
- South Dakota
- Wisconsin
- Alabama
- Arkansas
- Delaware
- Florida
- Georgia
- Kentucky
- Louisiana
- Maryland
- Mississippi
- North Carolina
- Oklahoma
- South Carolina
- Tennessee
- Texas
- Virginia
- West Virginia
- Alaska
- Arizona
- California
- Colorado
- Hawaii
- Idaho
- Montana
- Nevada
- New Mexico
- Oregon
- Utah
- Washington
- Wyoming

Copy each role ID:
- Enable Developer Mode in Discord.
- Right-click each role in Server Settings → Roles → Copy Role ID.
- Create a JSON object mapping exact state names to role IDs.

Example:
```json
{
  "Alabama": "123456789012345678",
  "Alaska": "123456789012345679"
}
```
All 50 entries are required. The bot validates this before publishing the panel.

## 3. Deploy Worker

Install Node.js, then:

```bash
npm install
npx wrangler login
npx wrangler secret put DISCORD_APPLICATION_ID
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put STATE_ROLE_IDS
npx wrangler deploy
```

For `STATE_ROLE_IDS`, paste the complete JSON object as the secret value.

Copy the deployed Worker URL, for example:
`https://state-selector-bot.<your-subdomain>.workers.dev`

## 4. Set the Discord Interactions Endpoint

In Discord Developer Portal → General Information:
- Interactions Endpoint URL: `https://YOUR-WORKER-URL/interactions`
- Save. Discord validates the endpoint with a PING.

## 5. Register the slash command

Set local environment variables:

```bash
DISCORD_APPLICATION_ID=...
DISCORD_BOT_TOKEN=...
DISCORD_GUILD_ID=...
npm run register-commands
```

The command is guild-scoped for immediate availability.

## 6. Register and publish

Run the command-registration workflow (or `npm run register-commands` with the three Discord environment variables). The command registration uses a guild-scoped overwrite, so it registers the complete command set in `scripts/register-commands.js`.

In your server, run:

`/statepanel publish`

The command requires Manage Roles permission. It posts the panel in the channel where it is invoked.

## 7. Optional GitHub auto-deploy

Add repository Actions secrets:
- `CLOUDFLARE_API_TOKEN` with Workers Scripts edit permission
- `CLOUDFLARE_ACCOUNT_ID`

Push to `main`; GitHub Actions deploys the Worker.

## 8. Optional POSTLAIN Voice Assistant (free-tier setup)

Voice is a separate service because Cloudflare Workers cannot hold the persistent Discord voice connection or send the required UDP audio packets. The repository includes a Dockerized voice service and Cloudflare Tunnel sidecar.

### Features and commands

- `/join`: join the voice channel that you are currently in.
- `/leave`: leave the voice channel (same-channel member or an Administrator).
- `/speak`: read up to 1,200 characters aloud; choose language and male/female voice.
- `/voice status`: show connection and queue status.
- `/voice stop`: stop playback and clear the queue.

Available TTS languages: Vietnamese, English, Japanese, Korean, Chinese, Spanish, French, German, Italian, Portuguese, Indonesian and Thai. Voice generation uses Microsoft's Edge Read Aloud service through the community `edge-tts` client. It has no API key or per-character API bill, but it is an unofficial upstream service and has no uptime or rate-limit guarantee.

### Free hosting architecture

Recommended: an Oracle Cloud Always Free Ampere A1 Ubuntu ARM VM, plus a free Cloudflare Tunnel hostname. Oracle's Always Free capacity is region-dependent; account verification and available capacity are controlled by Oracle. Do not create a paid instance or paid storage.

1. Create an **Always Free** Ampere A1 VM in Oracle Cloud. Use Ubuntu ARM64. Keep inbound access limited to SSH; the voice service does not need a public inbound port because Cloudflare Tunnel makes the outbound connection.
2. In Cloudflare Zero Trust, create a Tunnel and a public hostname such as `voice.example.com`, routing it to `http://voice:3000`. Copy the tunnel token.
3. Install Docker Engine and the Docker Compose plugin on the VM. Clone this repository after the Voice Assistant PR is merged.
4. In the repository, enter `voice-engine`, copy `.env.example` to `.env`, and fill in:
   - `DISCORD_BOT_TOKEN`: the existing POSTLAIN bot token.
   - `VOICE_ENGINE_SECRET`: a new random secret (generate with `openssl rand -hex 32`).
   - `TUNNEL_TOKEN`: the Cloudflare Tunnel token.
5. Start the service with `docker compose up -d --build`. Check `docker compose logs -f voice` until it reports Discord-ready.
6. In Cloudflare Worker settings, add:
   - `VOICE_ENGINE_URL`: the HTTPS hostname from step 2, without a trailing slash.
   - `VOICE_ENGINE_SECRET`: exactly the same secret used in the VM's `.env`.
7. Ensure the bot has **View Channel, Connect and Speak** permissions in the target voice channel. No new privileged Gateway intent needs to be enabled in the Developer Portal.
8. Run the existing **Register Discord Commands** GitHub Actions workflow once to publish `/join`, `/leave`, `/speak` and `/voice`.

Useful checks on the VM:
```bash
docker compose ps
docker compose logs --tail=100 voice
```

The Voice Engine exposes only an authenticated control API through the Tunnel. The unauthenticated `/health` endpoint reports service readiness only. Never commit `.env`, bot tokens, tunnel tokens or the shared secret. The existing Worker, Durable Object Gateway and all existing bot commands remain separate and continue to run as before.
## Important implementation notes

- Role exclusivity is enforced server-side by fetching the member's current roles, removing every configured state role, and adding the selected one.
- The bot preserves all roles outside the configured 50 state roles.
- Discord role hierarchy must allow the bot to manage every state role.
- Keep all tokens in Worker secrets / GitHub Actions secrets. Never commit them.
- Configure `SUPPORT_STAFF_CHANNEL_ID` to a private channel visible only to Staff and the bot.
- The bot needs View Channel / Send Messages in public support channels; Manage Roles for State Selector; Add Reactions for polls; Manage Messages for `/purge`; and Manage Channels for `/slowmode`, and Manage Roles for `/lock` and `/unlock`.
- `/lock` and `/unlock` support text and announcement channels. `/purge` skips messages older than 14 days, as required by Discord's bulk-delete API.
- Enable the Message Content privileged intent in the Discord Developer Portal for proactive message support.
- Discord member roles remain the source of truth for state selection. The Durable Object SQLite database stores only short-lived reply-rate-limit metadata, not message content or chat history.
- If two state selections are submitted at exactly the same time, Discord's member-role updates are last-write-wins. For a very large/high-concurrency server, add a per-member serialized queue before expanding.
