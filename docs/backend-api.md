# Backend API and local operation

## Booking settings contract (2026-10-11)

The owner can change scheduling policy in the private Telegram admin. Shared Nest methods are `bookingSettings(actor)` and `updateBookingSettings(field, value, expectedRevision, actor)`. Fields: `windowMinutes` (5–240), `horizonDays` (1–365), `noticeMinutes` (0–10080), integers only. Reads require owner/operator authorization; updates return `{ changed, settings }`, with stale/repeated changes returning the current row. Settings include revision/update time/actor. There is no new public settings mutation route; public booking options keep their existing numeric fields.

Migration 4 creates a singleton PostgreSQL row initialized once from the current API environment. Later environment changes/repeated migration do not reset owner settings. Every availability/options/reservation/new-window operation reads that policy, including across process restarts. Changes preserve existing slots/appointments. Bot publication previews carry the settings revision; a changed policy requires a new preview. Timezone stays `Europe/Moscow` for the confirmed Kazan location. The demo opening hours on the landing never generate actual availability.

Phase 2 is implemented in `apps/api`: NestJS 12, strict TypeScript, PostgreSQL 18 and `pg`. Native SQL constraints protect the single intake queue. Phase 3 now connects the form; public submission is off until approved consent/business inputs are configured. See [form operation](booking-form.md). Telegram linking/webhook/private management and basic durable sending are implemented; see [bot operation](telegram-bot.md). Protected owner HTTP routes remain pending.

## Setup and commands

Use Node.js 24+ and npm. From the repository root:

```bash
npm ci
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
docker compose up -d db
npm run db:migrate
docker compose exec -T db createdb -U service service_ilyxa_test
```

Create the test database only once. Compose binds PostgreSQL to `127.0.0.1:54329` and stores data in a named volume. Its credentials are for local development only. `docker compose stop db` preserves data; removing the volume deletes it. Migrations are explicit, transactional and repeatable; startup verifies the schema instead of silently migrating a deployment.

Run two terminals:

```bash
npm run dev --workspace @service-ilyxa/web -- --hostname 127.0.0.1 --port 3007
```

```bash
npm run dev:api
```

The API binds to `127.0.0.1:3008`. Its dev command compiles, watches TypeScript and restarts compiled Node code. Restart after `.env` changes. `npm run build` builds both apps; `npm run start` and `npm run start:api` start them separately. `npm run typecheck` and `npm run lint` check both workspaces.

Next.js forwards `/api/v1/:path*` to server-only `API_INTERNAL_URL`. Rebuild/restart Next after changing it. Browser clients use relative API URLs. Nest does not enable CORS or trust arbitrary forwarded headers. Submission requires the exact `PUBLIC_ORIGIN`. There are no owner cookies yet; phase 5 must verify cookie/session/logout/CSRF forwarding when it introduces them.

## Configuration

Backend variables belong only to `apps/api` or its deployment config/secret store:

| Variable                 | Meaning                                                         |
| ------------------------ | --------------------------------------------------------------- |
| `DATABASE_URL`           | PostgreSQL connection URL; TLS options depend on actual hosting |
| `TEST_DATABASE_URL`      | Separate disposable database; name must end in `_test`          |
| `PORT`                   | API port; default 3008                                          |
| `PUBLIC_ORIGIN`          | Exact website origin without credentials/path/query             |
| `SERVICE_TIMEZONE`       | Valid IANA timezone for dates and year validation               |
| `BOOKING_NOTICE_MINUTES` | Initial minimum notice, 0–10080                                 |
| `BOOKING_HORIZON_DAYS`   | Initial horizon, today + value, 1–365                           |
| `INTAKE_WINDOW_MINUTES`  | Initial intake duration, 5–240; not repair duration             |
| `CONSENT_VERSION`        | Approved notice identifier, max 100 characters                  |
| `CONSENT_NOTICE_URL`     | Published notice on `PUBLIC_ORIGIN`                             |
| `OWNER_TELEGRAM_IDS`     | Numeric allowlist checked by trusted private bot handlers       |
| `PUBLIC_BOOKING_ENABLED` | Explicit true/false gate for new public requests; default false |
| `NODE_ENV`               | Production requires HTTPS and rejects example consent values    |

Kazan and `Europe/Moscow` are confirmed. Initial policy/notice values are development inputs, not approved business facts. The three policy environment variables seed migration 4 once; use the owner’s Telegram `/settings` menu for subsequent changes. The example notice page intentionally does not exist. Approve and publish a real notice before connecting the production form. No services/windows are seeded. The owner confirmed on 2026-10-06 that approved consent/privacy documents do not exist yet; retain the default disabled gate. Manual CLI booking remains separate from the public gate. Existing committed receipts can still be retried after public booking is disabled. Current normalization matches the +7 prototype: ten local digits or leading 7/8, national prefix 3/4/8/9. Broader countries need an approved rule. Telegram tags are optional manual contacts and grant no identity/chat access.

## Public contracts

JSON responses have `Cache-Control: no-store`. Public lookup by phone, reference or appointment ID does not exist. Owner routes are absent (404).

| Method/path                         | Response                                                                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/v1/health`                | Database readiness: `{ status: "ok" }`                                                                                                                 |
| `GET /api/v1/booking-options`       | `{ enabled, timezone, noticeMinutes, horizonDays, windowMinutes, services: [{ key, title }], consent: { version, noticeUrl } }`; enabled services only |
| `GET /api/v1/slots?date=YYYY-MM-DD` | `{ date, timezone, slots: [{ id, start, end }] }`; service-local date, UTC ISO start/end; eligible published unoccupied windows only                   |
| `POST /api/v1/appointments`         | JSON body, exact `Origin`, `Idempotency-Key`; atomic preliminary request                                                                               |

Availability contains no personal data. Valid dates without eligible windows return an empty array; invalid dates return 400. Selecting a window does not hold it.

Submission body (replace placeholder UUID/version):

```json
{
  "slotId": "actual-slot-uuid",
  "name": "Имя клиента",
  "phone": "+7 (999) 123-45-67",
  "telegramUsername": "@optional_tag",
  "make": "Марка",
  "model": "Модель",
  "year": 2020,
  "mileage": 85000,
  "serviceKey": "unknown",
  "problem": "Что происходит с автомобилем",
  "consent": { "accepted": true, "version": "approved-version" }
}
```

Optional fields: year, mileage, Telegram tag, problem (required for `unknown`). Year: 1900 through current service-local year + 1; mileage: integer 0–5,000,000. Strings are trimmed/bounded per the product spec; unknown fields are rejected. Consent must be true/current; PostgreSQL supplies its timestamp. JSON limit: 16 KiB. User input, SQL errors, credentials and raw parser errors are not returned or logged.

Success is HTTP 200 for a new request or identical replay:

```json
{
  "id": "appointment-uuid",
  "reference": "IL-random-reference",
  "status": "pending",
  "revision": 1,
  "slot": { "id": "slot-uuid", "start": "UTC-ISO", "end": "UTC-ISO" },
  "timezone": "configured-timezone"
}
```

This receipt means preliminary persistence, not owner confirmation or Telegram delivery. It contains no customer details and grants no further rights. Generate a random 32-byte canonical base64url key (43 characters) per submission. Preserve key/body across uncertain network/server errors. An identical retry returns the original receipt even after a move, status change, catalog disabling or consent-version upgrade. An edited request after a definitive validation/conflict response needs a new key. Keep the key out of URLs/logs/analytics; never derive it from a phone. Only SHA-256 key hash and payload fingerprint are stored. Fingerprints include normalized payload, original phone and source/actor.

Errors: `{ code, field? }`.

| HTTP | Code                            | Behavior                                                        |
| ---- | ------------------------------- | --------------------------------------------------------------- |
| 400  | `INVALID_INPUT`, `INVALID_JSON` | Correct input, keep draft                                       |
| 403  | `ORIGIN_NOT_ALLOWED`            | Correct origin/deployment config                                |
| 409  | `BOOKING_DISABLED`              | Public intake is off; preserve input and show unavailable state |
| 409  | `SLOT_UNAVAILABLE`              | Refresh windows and choose another                              |
| 409  | `IDEMPOTENCY_CONFLICT`          | Same key was used for different input                           |
| 409  | `CONSENT_CHANGED`               | Reload notice/version and obtain consent again                  |
| 413  | `PAYLOAD_TOO_LARGE`             | Reduce JSON size                                                |
| 415  | `JSON_REQUIRED`                 | Send `application/json`                                         |
| 500  | `INTERNAL_ERROR`                | Outcome may be uncertain; retry same key/body                   |

Unmatched routes return 404/`HTTP_ERROR`.

## Shared service and local CLI

`BookingService` owns reservation/manual booking, scheduling, transitions and moves. Future HTTP/bot handlers authenticate/authorize their boundary before calling it. Owner actors additionally require a configured numeric ID; customer cancellation checks the actual stored Telegram binding and cutoff. The `local-cli` operator is trusted server-side CLI code for someone who already has OS/DB access, never an HTTP credential/fallback login/public body field. Never deserialize actors from browser/bot payloads.

After building, from the root:

```bash
npm run admin --workspace @service-ilyxa/api -- service unknown 'Approved Russian title' true
npm run admin --workspace @service-ilyxa/api -- publish FUTURE_ISO_START FUTURE_ISO_END
npm run admin --workspace @service-ilyxa/api -- visibility SLOT_UUID false
npm run admin --workspace @service-ilyxa/api -- close-date YYYY-MM-DD true
npm run admin --workspace @service-ilyxa/api -- status APPOINTMENT_UUID confirmed EXPECTED_REVISION
npm run admin --workspace @service-ilyxa/api -- status APPOINTMENT_UUID cancelled EXPECTED_REVISION 'Customer-facing reason'
npm run admin --workspace @service-ilyxa/api -- move APPOINTMENT_UUID TARGET_SLOT_UUID EXPECTED_REVISION 'Time agreed with customer'
```

Publication requires explicit ISO start/end with `Z`/offset, creates 1–96 contiguous configured-duration windows, and is atomic. All existing windows, including hidden ones, cannot overlap; adjacent intervals are allowed. The intake date is its start's service-local date. Closing a date hides windows/blocks publication but preserves appointments. Reopening (`close-date DATE false`) does not republish them. An individually occupied window cannot be hidden. Notice/horizon are rechecked inside submission/move transactions.

Manual command: `manual PRIVATE_JSON_FILE REQUEST_KEY`, with the same validated body and recorded consent. Keep PII out of shell history/committed files. It creates `source=manual`, `pending`, no fake Telegram identity. CLI output is only the receipt. Owner rejection/cancellation requires a reason. Completed/no-show requires arrival time. Terminal states cannot reopen. Customer cancellation requires a linked sender and future intake. Stale/repeated actions return current state without another event. A successful move preserves status and increments revision; failure preserves the original reservation.

## Persistence and outbox

Migration 1 creates `service_catalog`, `intake_slots`, `closed_dates`, `appointments`, `appointment_events`, `notification_jobs`, `submission_requests`, `schema_migrations`. Partial uniqueness enforces one pending/confirmed record per slot; a GiST exclusion constraint rejects overlaps. Slot locks recheck capacity/publication; moves lock both IDs in sorted order. Date locks coordinate closure/publication. Request-key advisory locks serialize identical submissions across processes.

Appointment, audit revision, two logical recipient jobs and receipt commit together. Jobs reference an event instead of copying PII. Event/recipient uniqueness and retry/claim/provider fields are persisted. Phase 4 resolves current revision/binding, suppresses obsolete events, fans out to authorized owners, skips unlinked customer delivery and handles retries through per-chat `telegram_messages`. Migration 2 adds link tokens/encrypted receipts, notes, inbox and flows; migration 3 orders multipart replies; migration 4 persists booking settings. Nested service operations share the durable inbox transaction. See [bot operation](telegram-bot.md). No exactly-once delivery claim is made.

## Verification and remaining work

```bash
npm run test:api
# Both configured local servers must be running:
npm run test:proxy
NODE_PATH=/absolute/path/to/existing/node_modules npm run test:smoke
```

The built-in Node API test refuses databases without `_test`, creates a unique temporary schema and removes only that schema. It checks booking/key races, normalization/consent, outbox rollback, restart replay, enabled services, notice/horizon, transition timing/ownership, release, overlap, failed/successful/stale moves, date closure and HTTP validation/origin. The proxy test checks GET/POST/body/header forwarding without creating a booking. Browser smoke checks four-width form/landing behavior with controlled API responses. The dedicated form check covers actual persistence; see [booking-form.md](booking-form.md).

Verified locally on 2026-10-06: both workspaces' typecheck/lint/build, API integration on PostgreSQL 18.3, same-origin proxy, four-width browser smoke, API dev startup/restart/shutdown and production dependency audit (zero findings). Test schemas were removed after each run. The dev calendar/catalog remain empty. The existing full audit still reports five development-tool findings in the Next ESLint dependency chain; see README.

Phase 3 now consumes these contracts and verifies saved/uncertain/conflict/error/mobile behavior; see [booking-form.md](booking-form.md). Actual notices/business configuration are still required to enable public intake. Phase 4 now implements linking and Telegram delivery; phase 5 adds protected website administration. Public hosting, edge abuse limits, credentials, retention, backup restoration and launch verification remain phase 6. No public deployment was performed.

Versions/behavior were checked using the npm registry and official references: [NestJS](https://docs.nestjs.com/first-steps), [node-postgres transactions](https://node-postgres.com/features/transactions), [PostgreSQL constraints](https://www.postgresql.org/docs/current/ddl-constraints.html).

## Phase-four contract addition

With `TELEGRAM_ENABLED=true`, a new committed public receipt includes optional `telegramLink` for that appointment. Token issuance and encrypted retry data commit with the reservation; the same idempotency capability returns the same original link without renewing expiry. Disabled bot/manual booking omits the field; existing linked receipts can still be recovered. No public appointment read/phone lookup was introduced.

`POST /api/v1/telegram/webhook` accepts only the authenticated Telegram JSON update boundary described in [telegram-bot.md](telegram-bot.md). It is not a browser-owner route and does not require browser Origin. There is no public drain/owner-registration route. New bot CLI commands and environment settings are documented there. Startup requires migration 4 and its singleton settings row.
