# POSTLAIN AI Phase 2 · Memory & Server Knowledge

Phase 2 stores administrator-curated server knowledge as messages in a private Discord text channel. This avoids adding a paid database or a separate always-on service.

## One-time setup

1. Create a private text channel, for example `#postlain-ai-knowledge`.
2. Give the bot access to that channel with **View Channel**, **Read Message History**, **Send Messages**, and **Embed Links**.
3. Do not grant ordinary members access. Keep this channel for trusted administrators only.
4. In Cloudflare Workers & Pages → `us-state-selector-bot` → Settings → Variables and Secrets, add a plain-text variable named `KNOWLEDGE_CHANNEL_ID` with that channel's ID.
5. Save and redeploy the Worker.

## Discord commands

- `/knowledge add topic:<topic> content:<content>`: save one knowledge entry (up to 1,500 characters).
- `/knowledge list`: show the latest entries and their message IDs.
- `/knowledge remove entry_id:<message ID>`: delete an entry.
- `/ask question:<question>`: answer using up to the latest 10 saved entries.

All `/knowledge` operations are checked server-side and are Admin-only. `/ask` remains Admin-only during beta.

## Data and safety

- The private Discord channel is the persistent store; no KV/D1 database is required.
- POSTLAIN AI reads only messages authored by this bot with the exact `POSTLAIN KNOWLEDGE` embed title.
- Knowledge is supplied to the model as reference facts, not as instructions. Do not store passwords, API keys, private personal data, or secrets.
- The Worker reads at most the latest 100 channel messages, uses up to 10 knowledge entries, and caps the injected knowledge context at 12,000 characters.
- If the knowledge channel is not configured, `/ask` continues without server-specific context.
- This phase does not enable Gateway message monitoring or autonomous server actions.