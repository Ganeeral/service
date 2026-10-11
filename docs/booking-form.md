# Connected booking form (phase 3)

The existing client-side form in `apps/web` now consumes the [actual Nest API](backend-api.md) through same-origin `/api/v1/*`. Static landing sections remain server-rendered. No new dependency or second backend was introduced.

## Current state and enabling intake

The user confirmed on 2026-10-06 that approved privacy/consent documents are not ready. `PUBLIC_BOOKING_ENABLED` defaults to false, so the current website honestly shows closed online intake; the backend rejects new public submissions with `BOOKING_DISABLED`. Existing committed receipts remain recoverable. No real services or windows have been invented/seeded.

Before enabling intake, approve the operator/notice and scheduling/country policies in [owner-inputs.md](owner-inputs.md), publish an actual same-origin notice, configure its `CONSENT_VERSION`/`CONSENT_NOTICE_URL`, enable approved catalog entries and set booking policy through the private bot’s `/settings` menu and publish real windows through `/publish` or the existing service/CLI. Then explicitly set `PUBLIC_BOOKING_ENABLED=true` and restart Nest. Production configuration rejects development/test notices and requires HTTPS. Do not enable the committed example config for real customers.

`/booking-test-notice` is a development-only explanation for controlled test records. It is not a legal document or service policy and returns 404 in a production build. Browser integration checks point only their isolated test API to it. Approved notices need their actual content/route when supplied.

## Customer flow

1. Load enabled services, consent version/link, timezone and booking date limits. Distinguish loading, connection failure, closed intake and unpublished catalog.
2. Select a service (including URL preselection when enabled), enter vehicle/problem and choose a date. Only server-returned windows appear; no fixture/fallback times exist in the application.
3. Date changes cancel stale requests. Show loading, empty-day/nearby-date choice and retryable load error separately. Display times in the service timezone, not the browser timezone. Nest rechecks notice, horizon, publication and capacity on submit.
4. Enter name, masked +7 phone and optional Telegram contact. Unknown service requires a trimmed problem description. Native constraints and inline errors preserve keyboard/focus behavior. Explicit consent starts unchecked and resets when consent/options reload.
5. Review vehicle, task, time and contacts before confirming. Review itself sends no personal data. Editing or changing the requested service invalidates the old review while retaining input.
6. Confirm once. Browser and server duplicate guards apply. The receipt displays its reference and clearly preliminary status; wait for administrator confirmation before visiting. When Nest returns the implemented optional `telegramLink`, show “Получать уведомления в Telegram”, Start instructions and 24-hour/private-link guidance. The client validates the t.me URL shape and opens it with no referrer; it does not claim that a message was delivered. Disabled bot configuration shows honest unavailable copy. Phone fallback uses approved service contact when supplied; otherwise the owner calls the submitted number.

## Recovery and data handling

Use a random 32-byte base64url request capability and immutable body for each actual attempt. Disable field editing while sending or when the response is uncertain. A timeout/network/malformed-success/5xx response may follow a committed appointment: keep the original key/body and offer “Проверить заявку ещё раз”, which retries the same POST. Do not create a second request or clear entered data. Warn before leaving an unresolved attempt. Successful receipts disable further submission.

A definitive slot conflict refreshes windows while preserving vehicle/contact details; selecting a new window creates a new key. Server field errors focus the actual invalid control after it is enabled again. Changed consent reloads options and clears the checkbox. Disabled intake reloads current configuration. Origin/configuration errors show an honest message. All API errors are translated to Russian without exposing raw backend text.

Drafts, capabilities and receipts remain in component memory, not URLs, analytics, cookies or local/session storage. Keep an uncertain page open until the retry resolves; reloading loses that private in-memory recovery data. This deliberately avoids persisting customer details in the browser. The bot tag is a manual contact, not chat authorization. The +7 mask remains the approved implementation boundary pending country input.

## Verification

With PostgreSQL and the existing local Next server running:

```bash
npm run typecheck
npm run lint
npm run build
npm run test:api
npm run test:proxy
NODE_PATH=/absolute/path/to/existing/node_modules npm run test:smoke
NODE_PATH=/absolute/path/to/existing/node_modules npm run test:booking
```

`test:smoke` uses explicitly controlled API responses for four viewport widths (360/390/768/1440), dropdown keyboard/typeahead/validation, service preselection, phone editing/paste, consent/review, preserved input and FAQ/reduced motion. It asserts no writes before confirmation.

`test:booking` requires `TEST_DATABASE_URL` ending in `_test`, creates/removes its own schema, starts a test Nest server, forwards browser API traffic to it and verifies real PostgreSQL persistence. It covers a lost response after commit and same-key replay (one appointment/event/two jobs), duplicate clicks, another customer taking a displayed slot, new-key recovery, field focus, consent reset, empty/failed availability, closed intake and mobile success. All customer data is synthetic. It does not change the dev catalog/calendar or send messages. `BASE_URL` defaults to `http://127.0.0.1:3007`; screenshots are saved in an OS temporary directory.

Same-origin production routing remains checked independently by `test:proxy`; owner cookie/auth flows remain phase five; phase-four bot sending is documented in [telegram-bot.md](telegram-bot.md). Launch requires actual notices, owner credentials/business content, edge abuse limits, deployment, backups and operational checks.

Verified on 2026-10-06: both-workspace TypeScript/lint/build, API invariant test, proxy check, four-width browser smoke and form-to-Nest-to-PostgreSQL integration passed. Desktop/mobile saved-state screenshots were visually reviewed. Development catalog/calendar/appointments remain empty, and all temporary test schemas were removed. No production intake, real Telegram delivery or public webhook was enabled. The isolated test API now enables a synthetic bot configuration to verify the actual generated linking URL without running its automatic send loop.

## Shared booking policy (2026-10-11)

Duration, booking horizon and minimum notice now come from the singleton PostgreSQL settings row. Owner changes through Telegram apply to subsequent public options/availability/reservation calls without restarting the API. Reload an already-open form to refresh its displayed policy. Submission still checks the current policy transactionally, so an obsolete date/window cannot bypass changed rules. No public settings-write route is introduced. Kazan is confirmed; landing address/phone/hours remain labeled demo content and do not feed availability or phone fallback.
