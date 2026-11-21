# POSTLAIN AI — Phase 1

## Scope

Phase 1 adds a chat-only AI assistant through the existing Discord Interactions endpoint. It does not add Gateway message ingestion or Discord administration tools yet.

Existing commands and behavior are preserved:
- `/statepanel publish`
- `/noti send`
- `/feedback send`
- State selector component interactions

New command:
- `/ask question:<text>`

## AI provider fallback

Provider order defaults to `gemini,openrouter`. Gemini is tried first, then OpenRouter Free Models Router. Groq support is optional and is not included in the free-first default because its current model catalog includes metered models. The first configured provider is attempted; on provider errors, the next configured provider is tried.

Cloudflare Worker secrets:
- `GEMINI_API_KEY`
- `GROQ_API_KEY`
- `OPENROUTER_API_KEY`

Optional Worker variables:
- `AI_PROVIDER_ORDER` — comma-separated order, e.g. `gemini,groq,openrouter`
- `AI_GEMINI_MODEL`
- `AI_GROQ_MODEL`
- `AI_OPENROUTER_MODEL`

Default models: `gemini-3.8-flash` and `openrouter/free`. OpenRouter dynamically routes to an available free model, avoiding a hard-coded free model ID. Groq is optional; explicitly add `groq` to `AI_PROVIDER_ORDER` only if you have confirmed the chosen model and account usage are free for your account. Model availability and free limits can change.

Do not put API keys in GitHub files, Discord messages, or `.dev.vars.example`. Add them as Cloudflare Worker Secrets.

## Register slash commands

Run the existing registration script after deploying/merging this branch. It uses a PUT request and therefore registers the complete command list, not just `/ask`.

## Deploy safety

This feature branch does not trigger the current GitHub Actions deployment workflow, which deploys only on pushes to `main`. Review and merge only after testing.

## Phase 1 limitations

- AI only sees the question submitted to `/ask`.
- No persistent memory or channel-history access.
- No message-content Gateway connection.
- No moderation or server-changing tools.
- Provider fallback is sequential and bounded by a 22-second timeout per provider. A persistent global cooldown / quota guard is not yet included; add it before opening `/ask` to a large public server.
