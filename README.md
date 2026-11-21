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
- POSTLAIN Community Assistant detects support topics in permitted channels, responds in Vietnamese or English, asks one clarifying question, and routes safety reports to the private Staff room. Ordinary chat is ignored. New-member greetings are handled by Carl-bot.

## Architecture

Discord Interactions Endpoint and a Cloudflare Durable Object Gateway handle commands and live community messages. The Gateway uses a structured multilingual support engine with topic priorities, built-in guidance, and 15-minute support sessions. Sessions store only category and message references, never message history or message content. Members can reply `staff` during an active session to request human help. Safety reports are forwarded to the configured private Staff room. Staff, moderation, ticket and private rooms are excluded from message reading.

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
