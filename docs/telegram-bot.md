# Telegram bot (phase 4)

Implemented in NestJS using the native Bot API and existing PostgreSQL/booking services. No bot library, broker or additional dependency was introduced. The website returns a real linking URL only when bot configuration is enabled. The protected website owner dashboard/login remains phase 5; `/web` explicitly says it is unavailable and grants no access.

## Configuration

Keep these values in `apps/api/.env` or the API deployment's secret store. Never put secrets in Next.js, screenshots, committed files or chat. The user supplied `@ilyxa_service_bot` and numeric owner ID `733375528`; these non-secret values are configured. Secrets and enable flags remain local. Live transport/webhook is not verified.

| Variable                  | Value                                                               |
| ------------------------- | ------------------------------------------------------------------- |
| `TELEGRAM_ENABLED`        | `false` by default; `true` requires all four settings below         |
| `TELEGRAM_BOT_TOKEN`      | Actual BotFather token, without quotes/URL prefix                   |
| `TELEGRAM_BOT_USERNAME`   | Actual username, without `@`                                        |
| `TELEGRAM_WEBHOOK_SECRET` | Random 32–256-character ASCII secret, independent of bot token      |
| `OWNER_TELEGRAM_IDS`      | Comma-separated numeric user IDs; usernames grant no access         |
| `PUBLIC_ORIGIN`           | Canonical website HTTPS origin for webhook setup                    |
| `SERVICE_PHONE`           | Approved international-format phone; otherwise honest fallback copy |
| `SERVICE_ADDRESS`         | Approved address; blank until confirmed                             |
| `SERVICE_DIRECTIONS_URL`  | Approved HTTPS map/directions URL; blank until confirmed            |

Generate a webhook secret locally, then place it in `.env` (do not commit its output):

```bash
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))"
```

A customer's optional Telegram tag remains a manual contact. The bot binds an appointment only after private Start through the saved receipt link. Each owner must also start the bot privately. Telegram cannot initiate a conversation with an arbitrary new user. [Official bot introduction](https://core.telegram.org/bots).

## Setup

1. Keep `PUBLIC_BOOKING_ENABLED=false` until actual business inputs and approved published notices exist. Draft legal documents do not enable booking. See [legal release checklist](legal/release-checklist.md).
2. Set bot token/username/webhook secret and actual owner IDs in the API environment. IDs must come from trusted account information. `/start` echoes the sender's own numeric ID; it never enrolls an owner.
3. Run migrations/build. Restart Nest after environment changes. Local `127.0.0.1` cannot receive a Telegram webhook; use an explicitly approved public HTTPS environment/tunnel with the same canonical origin and API routing. Do not register a production webhook to a temporary tunnel by accident.
4. Only after choosing that environment, explicitly register the webhook using the local CLI. Registration changes the existing bot's delivery destination:

```bash
npm run db:migrate
npm run build --workspace @service-ilyxa/api
npm run admin --workspace @service-ilyxa/api -- bot-setup
npm run admin --workspace @service-ilyxa/api -- bot-status
```

`bot-setup` validates the token's actual username with `getMe`, installs `/api/v1/telegram/webhook`, retains pending updates, limits initial webhook connections to one, and subscribes to `message`/`callback_query`. It reads secrets from the API environment and never prints the token. `bot-status` prints only configured/pending count/last error timestamp. Secret-header authentication follows [setWebhook](https://core.telegram.org/bots/api#setwebhook).

Next's existing `/api/v1/*` rewrite also forwards the webhook to Nest. Nest requires JSON, a valid secret header, bounded input, actual non-bot sender identity, and matching private-chat ID. Unsupported/group/channel updates are acknowledged without saving customer data. Disabled bot route returns 404; wrong secret returns 403; malformed updates return 400. Successful acknowledgment is 200 and means durably accepted, not processed/sent.

## Customer experience

The committed public receipt optionally adds `telegramLink`: `https://t.me/BOT_USERNAME?start=OPAQUE_TOKEN`. The token is 32 random bytes, base64url, scoped to one appointment and valid for 24 hours. The deep-link length/character rules are documented in [Telegram features](https://core.telegram.org/bots/features#deep-linking).

PostgreSQL stores the token hash. Idempotent receipt recovery stores the URL encrypted with AES-256-GCM using a key derived from the unpersisted submission capability; it does not save the token/URL as plaintext. A same-key retry returns the original link, even after bot configuration is disabled or credentials change. It does not renew expiry. The trusted webhook inbox stores a linking hash instead of the raw Start token and clears processed payloads.

Private Start atomically consumes the token and binds the actual sender ID. Same linked sender replay shows current status; another sender cannot rebind or see the reference. Unused expired links reveal no booking data. The link is a temporary capability, not proof that the Telegram user owns the submitted phone. Do not forward it. Recovery after expiry requires owner/customer verification; there is no public lookup by phone.

`/mine`, “Мои записи” and cards display only linked appointments. Late Start displays current status, including confirmation performed before linking. Cancellation asks for explicit confirmation and uses the shared future-window/ownership rules. Transfer requests go to the owner. Directions/phone use actual configured contacts, not reference-image values.

## Owner interface

Every command, callback and continuation checks the numeric allowlist and private context. Long appointment lists use five-card pagination. Persisted flows last 15 minutes and bind confirmation/slot callbacks to the current random nonce. `/cancel` abandons the flow. Removed owners cannot continue a previously started operation.

| Command/menu                            | Behavior                                                                                                                                                                   |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/admin`                                | New requests, today, week, windows, booking settings, manual booking, delivery problems, help, website admin status                                                        |
| `/pending`, `/today`, `/week`           | Shared records in the service timezone, paginated cards                                                                                                                    |
| Card actions                            | Confirm, reasoned reject/cancel, agreed move, complete/no-show after intake begins                                                                                         |
| Note action                             | Owner-only note, max 2000 characters; `-` clears it; no customer notification                                                                                              |
| `/settings` / “Настройки записи”        | View/change persisted window duration, horizon and minimum notice; integer validation, preview and explicit confirmation                                                   |
| “Свободные окна”                        | Enter a date, then view/manage that date’s windows                                                                                                                         |
| `/windows YYYY-MM-DD`                   | Existing published/hidden/occupied windows; free-window hide/show confirmation                                                                                             |
| `/publish START END`                    | Preview a series/count, then publish using existing duration/overlap/date rules; timestamps must include offset, such as `2027-01-20T10:00:00+03:00` (format example only) |
| `/close YYYY-MM-DD`, `/open YYYY-MM-DD` | Confirm date closure/reopening; existing appointments remain; reopening does not republish windows                                                                         |
| `/manual`                               | Name, phone, make/model, enabled service key, problem, date/window and final consent attestation; shared reservation/idempotency; no fictitious Telegram identity          |
| `/failures`                             | Failed sends, phone fallback and retry; reports exhausted inbound updates needing server attention                                                                         |
| `/web`                                  | Honest phase-five status; no owner login capability issued yet                                                                                                             |
| `/help`, `/cancel`                      | Help/current-input abort                                                                                                                                                   |

Policy values are persisted by migration 4, initially seeded once from the API environment. Bounds: duration 5–240 minutes, horizon 1–365 days, notice 0–10080 minutes. Stale confirmation returns current settings instead of overwriting another owner. Website options and reservation checks read the same row; no API restart is required. An already-open form may need a reload to display new policy; reservation always rechecks current rules. Duration changes affect only newly published windows. A publication preview made under an older settings revision must be reviewed again. Existing appointments/slots are preserved, even when narrower policy hides free windows from new public intake. Opening hours on the landing are demo copy and never generate a schedule.

Moves show old/new time and customer-facing agreement before confirmation. Target capacity is rechecked transactionally; a conflict preserves the original. Reject/cancel reasons are separate from private notes. Manual consent attestation records owner/source/version/time but does not manufacture proof of how the customer's consent was obtained: retain that evidence under the approved offline process.

## Durable processing

Migration 2 adds link tokens, encrypted receipt field, private notes, a durable webhook inbox, expiring flows and per-chat message deliveries. Migration 3 adds durable ordering for multipart replies. Existing logical event/recipient jobs remain unchanged. Nested shared booking operations participate in the inbox transaction through `Database`'s transaction context: mutation, flow, replies and processed marker commit together. Failed commands roll back to a savepoint. Different updates for the same sender are processed in order; exact update replay does nothing.

A single supervised long-running Nest process initially runs a one-second polling loop when enabled. Test configuration disables the automatic loop. PostgreSQL locks/claims support recovery; network calls occur outside booking transactions. No public worker/drain route exists.

Event jobs fan out once per configured owner and linked customer. Unlinked customer jobs are skipped, not treated as failed bookings; owner cards show phone fallback. Superseded revisions are skipped. Pending notification payloads are rebuilt against current revision/binding/access before transport. HTML escapes customer input. Replies/cards and callback acknowledgments also go through durable delivery.

Sends have a 10-second timeout, 45-second recoverable claims and eight attempts. Transient failures back off; Telegram 429 honors `retry_after`, bounded to seven days to reject unbounded provider values. Permanent 4xx failures, including blocked chats, remain visible. Accepted sends mean Telegram acceptance, not a read receipt. A crash after Telegram accepts but before PostgreSQL records acceptance may duplicate a message; no exactly-once claim is made. Revision can change during the external request: obsolete queued events are suppressed, but an already in-flight older message cannot be recalled.

## Operations and remaining release work

```bash
# Redacted counts/codes and exhausted update IDs; no customer text/token:
npm run admin --workspace @service-ilyxa/api -- bot-failures
# After resolving the underlying issue, retry one exhausted inbound update:
npm run admin --workspace @service-ilyxa/api -- bot-retry-update UPDATE_ID
# One cycle, using the configured bot; may send real messages, use deliberately:
npm run admin --workspace @service-ilyxa/api -- bot-drain
```

The server CLI requires trusted OS/environment access. Never expose it as a public HTTP endpoint. Failed-message retry is available only to an authorized owner; it rechecks current state/access.

Before production, phase 6 must add actual infrastructure supervision/independent monitoring, edge request limits, backup restore verification and approved retention/deletion operations. Current code does not automatically purge stored appointments, delivery payloads or exhausted inbox entries. Clearing processed inbox payloads is implemented; do not claim full retention cleanup. Keep Telegram contact processing, hosting locations and recipients aligned with [privacy draft](legal/privacy-policy-draft.md).

## Verification

`npm run test:api` runs Node's built-in tests on a separate database ending in `_test`, in unique removed schemas. Telegram's native HTTP transport is mocked; no real users/messages/webhook registrations are contacted. Coverage includes secret/group rejection, stored-token protection, linking/replay/expiry/late status, customer ownership, stale/duplicate callbacks, removed-owner continuation, private notes, manual booking, atomic publication/date closure, failed move, rollback when reply persistence fails, flow expiry, obsolete retry suppression, 429, permanent blocked-chat failure and claim recovery after application restart. Coverage also includes invalid/unauthorized settings edits, duplicate confirmation, two-owner stale policy, stale publication preview, date-entry menu, policy persistence after restart, public options and unchanged existing windows. The existing booking transaction/race checks also run.

`npm run test:booking` uses actual form → Nest → PostgreSQL with a test bot config, verifies the real generated link/Start copy on desktop/mobile, and does not run the sending loop. Actual BotFather credentials, public HTTPS webhook and live dedicated test accounts still need manual verification. No deployment or production intake was enabled by this implementation.

## Changed files

- Backend: `apps/api/src/telegram.service.ts`, `telegram-api.ts`, `telegram-link.ts`; shared `booking.service.ts`, `database.ts`, `config.ts`, `app.ts`, `cli.ts`.
- Persistence/configuration: `apps/api/migrations/002-telegram.sql`, `003-message-order.sql`, `004-booking-settings.sql`, `apps/api/.env.example`, `apps/api/package.json`.
- Verification: `apps/api/src/test/telegram.test.ts`, existing `booking.test.ts`, `scripts/smoke-booking.mjs`.
- Form: `apps/web/src/lib/booking-api.ts`, `apps/web/src/components/booking-form.tsx`.
- Documentation: `README.md`, `AGENTS.md`, `docs/product-spec.md`, `implementation-prompts.md`, `owner-inputs.md`, `backend-api.md`, `booking-form.md`, this runbook and the three files in `docs/legal`.

No production secrets or private `.env` values were added to documentation. Local migrations were applied without adding real services/windows/appointments. Checks: both-workspace typecheck/lint/build, both PostgreSQL integration checks, proxy check, four-width browser smoke, real form persistence/Telegram-link smoke, local documentation links. Live Telegram and deployment remain unverified.
