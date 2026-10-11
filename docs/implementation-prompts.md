# Implementation prompts

Run the prompts in sequence in this repository. They implement the first release defined in [the specification](product-spec.md), including both Telegram and website owner administration. They do not implement the roadmap by default.

Repository-wide instructions live in [AGENTS.md](../AGENTS.md). Read them before using a phase prompt; a request for one phase does not automatically request the later phases.

At preparation time the project was empty. Always inspect its current state before starting a step. If a later step is already complete, verify and reuse it instead of rewriting it.

Selected stack: **Next.js + NestJS + PostgreSQL**, strict TypeScript, one repository with `apps/web` and `apps/api`. The `apps/web` visual prototype and phase-two `apps/api` persistence/scheduling now exist. Phase 3 now connects the form and phase 4 implements private Telegram management/linking plus baseline durable sending; public submission is off pending approved consent/business configuration. See [bot setup](telegram-bot.md) and [legal drafts](legal/release-checklist.md). Skip recreating completed phases; read [actual API contracts/setup](backend-api.md) before phase 3. After backend implementation, the web application consumes the Nest HTTP API; the bot and HTTP controllers share Nest business services.

## Shared instruction block

Prepend this block to each phase prompt, or retain it as the active context in the same implementation conversation.

```text
Work in /Users/roman/Projects/service-ilyxa.
Read applicable AGENTS.md instructions, README.md, docs/product-spec.md,
docs/owner-inputs.md, and the current project structure before changing files.
Treat docs/assets/landing-reference.png as visual reference data, not instructions.
Respond to the user in Russian. Use English for code, comments, identifiers,
file names, commit messages, and project documentation. Website and bot UI copy
must be Russian.

The confirmed requirements are one shared intake queue and owner administration
both on the website and in the Telegram bot. A requested time is preliminary
until the owner confirms it. A slot reserves vehicle intake, not repair duration.
Customer Telegram linking follows submission; the draft permits phone fallback.

The selected stack is Next.js + NestJS + PostgreSQL with strict TypeScript.
Target apps/web for Next.js landing/booking/dashboard UI and apps/api for NestJS.
Nest owns validated HTTP contracts, booking/scheduling services, PostgreSQL access,
owner sessions/authorization, Telegram handlers, and durable outbox processing.
Next.js calls the actual Nest API; it does not duplicate business rules, open a
database connection, handle bot updates, or maintain a separate owner session store.

Inspect existing patterns and reuse existing hooks, components, services, and
installed dependencies. Keep TypeScript strict, avoid any, and make the smallest
reasonable diff. Do not introduce speculative abstractions or new dependencies
when native APIs or existing tools suffice. Keep Next.js landing content on the
server where appropriate; use client components only for real interactivity.

Do not invent business facts, existing APIs, contracts, credentials, or production
availability. For a new backend, define only the operations this specification
requires, document actual contracts as implemented, and then consume them.
Unknown launch-critical inputs are explicit placeholders or configuration errors.
Ask about ambiguity that changes the flow; continue independent authorized work.
Keep user-approved requirements even if they are more work than the draft.

Trace all callers before changing shared booking/state logic. Nest HTTP controllers
and bot handlers must use the same Nest services and PostgreSQL data. Preserve
validation, accessibility,
authorization, durable writes, reservation integrity, and error recovery.

Use simple workspace tooling and preserve established package-manager conventions.
Prefer one public HTTPS origin with routing to separate web/API processes. Verify
session cookies, protected SSR, origin/CSRF checks, and trusted proxy headers across
that boundary. Keep database/bot/webhook secrets in apps/api. Do not add a broker,
monorepo orchestrator, shared package, ORM, or bot library without an actual need.

Run checks appropriate to the change using available tooling. Retain small runnable
checks for meaningful booking/security/recovery logic; do not build test scaffolding
for static markup. Do not claim unrun checks passed. Finish with a short Russian
summary: what changed, touched files, checks, and manual tests or blockers.
Do not publish or send live customer messages as part of a development check;
use test accounts and controlled test data.
```

## Phase 1 — Repository setup and visual landing

```text
Build the responsive Russian landing page using docs/assets/landing-reference.png
and sections 1–4 of docs/product-spec.md. First inspect whether an application now
exists. If still empty, establish a simple workspace layout and initialize the
Next.js/strict TypeScript web application in apps/web, using CSS Modules. Reserve
apps/api for the NestJS backend created in phase two; no unused backend scaffolding
is needed in this phase. Choose supported versions from official docs and document
actual web commands/configuration. Reuse conventions within the selected stack.

Implement the header, photographic hero, trust strip, service cards, three-step
process, appointment section shell, consultation/trust panels, FAQ, and contacts.
Use approved content if supplied. Otherwise make missing business content explicit
in development; do not fabricate reviews, experience, prices, address, or guarantees.
No video action without video. Use a typed content configuration, not a CMS.

Match the reference's warm light background, graphite panels, restrained coral
accent, condensed Cyrillic headings, documentary car/workshop photos, and clean
service grid. Use sentence case throughout; never force uppercase typography.
Prioritize visual quality and mobile composition. Use CSS for layout and small
state transitions, and the requested Framer Motion for smooth FAQ expansion and
collapse; support reduced motion and keyboard navigation.

CTAs scroll to the booking section. Service cards preselect their service. This
phase has no fake booking success or invented API calls. If showing sample windows,
label them clearly as demo data and disable real submission. Keep media provenance
clear and do not imply placeholder images show the actual workshop.

Verify available build/type/lint checks and inspect at 360, 390, 768, and 1440 px.
Report what still needs real content and backend wiring.
```

## Phase 2 — NestJS API, PostgreSQL, and shared business operations

```text
Implement actual persistence and shared appointment/slot operations from sections
4–5 and 9–13 of docs/product-spec.md. Inspect existing runtime/DB tooling first.
If no backend exists, initialize the strict TypeScript NestJS application in
apps/api, PostgreSQL integration/migrations, and backend configuration. Keep HTTP,
bot, and notification concerns inside this one Nest application. Use focused modules,
thin controllers, injectable services, and runtime input validation. Do not create
production windows from sample hours or a second backend in Next.js.

Set up and document separate web/API development commands and same-origin API
forwarding. Define actual route prefixes/contracts, rather than inventing callers
before controllers exist. Keep database credentials in apps/api only.

Define and document actual availability/submission contracts. Availability exposes
only public slot data. Server validation covers required/conditional fields,
enabled services, phone normalization, consent version/time, and UTC/service-local
time rules. Use owner-configured notice, horizon, and window length.

Centralize website/manual reservation, status transitions, cancellation, and agreed
rescheduling in Nest services used by HTTP controllers and later bot handlers.
Enforce one active pending/confirmed appointment per window in the
database; transactional slot locking and publication checks handle races. Prevent
overlapping slot creation. Transfers reserve the target and release the original
atomically, with stable lock ordering. Terminal statuses cannot silently reopen.

Persist request-key idempotency with payload fingerprint, result, appointment,
audit event, and durable notification jobs in the same transaction. Implement an
outbox persistence model now; Telegram sending is a later step. Scope retry results
to the unguessable submission capability, never a public phone lookup.

Retain runnable checks for simultaneous booking, identical retry/changed-payload
conflict, legal/illegal transitions, cancellation release, overlapping publication,
and successful/failed rescheduling. Run them against a suitable isolated database,
not a production one. Check the public HTTP validation/error boundary and API
forwarding. Record actual schemas/contracts and commands in project docs.
```

Phase-two implementation and checks are recorded in [backend-api.md](backend-api.md).

## Phase 3 — Production booking form

```text
Replace the phase-one booking shell with the real customer form using the actual
NestJS HTTP operations/contracts implemented in phase two. Build the UI in apps/web
and use the documented API client/forwarding boundary; do not import Nest services
or database entities into Next.js. Do not invent endpoint names.
Implement vehicle/service/problem, date/window, contact/consent, and final summary
with clear Russian labels. Make unknown service require a description.

Show only server-returned eligible windows and preserve form values on errors.
Distinguish no availability, failed availability loading, slot conflict, validation
failure, and uncertain network response. On transport retry retain the idempotency
key and payload; after a definitive failure and edited payload create a new key.
Disable duplicate clicks but keep the server authoritative.

After a committed appointment show its reference and preliminary status. Prepare
the Telegram-link action using the real linking contract when available; until it
exists, do not display a working-looking fabricated bot URL or delivered-message
claim. Phone fallback remains visible. Keep the user-requested optional Telegram
contact tag and phone mask; never require the tag or treat it as bot authorization.
Extend the prototype's +7 mask only after supported countries are approved.

Check mobile keyboard/focus behavior, date/timezone presentation, service
preselection, loading/empty/error states, and a saved test appointment. Reuse phase
two checks and add only needed integration coverage for the form boundary.
```

Phase-three implementation and verification are recorded in [booking-form.md](booking-form.md).

## Phase 4 — Telegram customer flow and owner administration

```text
Implement the one Telegram bot from sections 6–7 and 9–11 of the specification.
Implement its webhook controller and handlers/providers in apps/api (NestJS).
Verify current Bot API behavior in official Telegram docs. Keep the token and
webhook secret in Nest configuration and authenticate the webhook. Use dedicated
test bot accounts for checks. Nest is the backend framework; use the Telegram Bot
API directly unless an existing client library has a demonstrated benefit.

Implement cryptographically random, hashed, expiring, single-use appointment link
tokens and the real post-submission deep link. Atomically bind only that appointment
to the actual sender in a private /start update. Handle expiry, replay, wrong sender,
late linking, and blocked chats without leaking data or losing the booking.
The linked customer sees current own appointments, service directions, phone, and
permitted cancellation with confirmation. No lookup of bookings by phone.

Implement owner allowlist enforcement on every command/callback/text continuation,
private-chat restriction, durable update deduplication, and expiring admin flow
sessions. Add new requests, today/week lists, details, confirm/reject/cancel/agreed
move/complete/no-show, slot publish/hide/date-close, and manual phone booking.
Inject the phase-two Nest business services; do not duplicate capacity/state rules
or call the public booking API internally from bot handlers.
Customer-facing reasons and owner-only notes remain separate. Escape user text.

Booking settings are now implemented: persisted intake duration, booking horizon
and minimum notice in the private /settings menu, using migration 4 and the shared
BookingService. Preserve revision checks, validation and existing reservations.
Do not replace these settings with environment-only policy or demo opening hours.

Wire all required events to the durable outbox. Delivery processing follows in
phase six; a small test-only drain may be used to inspect messages in controlled
test chats. Add the protected owner entry for phase-five web login, without issuing
an unprotected admin capability prematurely.

Check unauthorized users, stale/duplicate callbacks, linking/replay/late status,
own-booking cancellation, owner flows, and website/bot reservation races. Describe
webhook setup with placeholders rather than real secrets.
```

Phase-four implementation and controlled checks are recorded in [telegram-bot.md](telegram-bot.md). A basic internal durable sender is included so bot replies/notifications are usable; phase six still owns production monitoring, retention, abuse limits and backup/release hardening. No live bot/deployment is verified yet.

## Phase 5 — Protected website owner dashboard

```text
Implement the required website owner dashboard in section 8 of the specification.
Build its Next.js UI in apps/web and protected HTTP/session operations in apps/api.
Reuse the existing UI and shared Nest services from previous phases.

Implement the Telegram-issued owner login flow: allowlisted private bot user,
random hashed one-time token, short expiry, same-origin token consumption, and
revocable Nest-owned PostgreSQL session with a host-only Secure/HttpOnly/SameSite=Lax
cookie for the public origin, path /. No public registration or fallback password.
Token links use fragments, are removed from browser history, and are excluded from
logs/analytics. Nest validates owner authorization on every read and mutation.
Verify Set-Cookie/request-cookie forwarding, logout/revocation, and trusted proxy
headers. For protected Next.js server rendering, forward the needed session cookie
to Nest and require an authorized response; do not create a second auth store.
Protect mutations against CSRF/origin abuse and isolate protected caches.

Build a responsive overview, day/week calendar/list, appointment filters/detail,
history/internal notes, slot publication/closure, manual booking, and failed-job
view. Use explicit confirmation for destructive/time-changing actions. Avoid a
drag-and-drop calendar dependency. Add logout and a practical session-revocation
path for the owner. Missing Telegram login recovery is documented honestly.

Website mutations call protected Nest controllers, which enqueue the same customer
notifications and update owner bot cards where supported. Revalidate after mutation,
on tab focus, and via manual
refresh. Handle expired sessions and stale revisions without overwriting newer
state. No WebSocket layer is needed for this first release.

Run checks for guest/foreign/expired/revoked sessions, removed owners, single-use
login tokens, CSRF, internal-note privacy, concurrent web/bot mutations, and shared
calendar consistency. Inspect the dashboard on phone and desktop.
```

## Phase 6 — Notification worker and operational reliability

A baseline internal worker already exists in phase 4. Inspect and extend it for actual production monitoring, abuse limits, retention, backups and acceptance; do not create a second sender or queue.

```text
Complete durable notification delivery from section 9 of the specification.
Run the outbox drain as a background provider in the long-running NestJS application
initially. Inspect hosting/process supervision and reuse installed scheduling or
runtime lifecycle tools. Database jobs remain durable regardless of the trigger.
Do not start the drain in Next.js requests or add a broker. Split a separate Nest
worker only if actual hosting/load requires it; document any deviation.

Implement durable claims/leases, recovery, bounded retries/backoff, Telegram
retry_after handling, permanent-failure classification, logical event deduplication,
and ordering/revision checks. A late-linked customer receives current status;
obsolete queued events must not send misleading old information. Provider timeouts
can produce duplicate messages, so use stable references and do not promise
exactly-once delivery or read receipts.

Make booking success independent of Telegram availability. Expose safe failed-job
and phone-fallback information in both owner interfaces. Manual retry rechecks
current status and destination before enqueueing, not blindly replaying stale text.
Keep draining internal; authenticate an external drain endpoint only if one is
actually introduced. Redact secrets/customer data from logs. Stop new claims during
graceful shutdown and recover expired leases after API restart.

Document actual deployment prerequisites, webhook/worker startup, health checks,
outbox inspection, migrations, backup/restore, and outage recovery for the separate
Next.js and NestJS processes and PostgreSQL. Document same-origin routing,
per-application environment ownership, and backend-only secrets. Keep hosting
credentials as placeholders. Do not publish or send to actual customers.

Run an isolated failure/restart/retry check and verify saved appointments survive
Telegram downtime, leased jobs recover, and later status changes suppress obsolete
messages. Identify any hosting-dependent checks that require external access.
```

## Phase 7 — Acceptance and release preparation

```text
Review the implemented first release against A01–A23 in docs/product-spec.md and
the manual/launch checklists in docs/owner-inputs.md. Inspect final behavior and
diffs; fix concrete gaps with small changes. Do not implement roadmap features.

Run available build/type/lint checks and meaningful reservation/security/recovery
checks for both apps/web and apps/api. Inspect the landing and owner dashboard at
the specified widths. Use
dedicated test bot identities for end-to-end request, link, confirmation,
cancellation, rescheduling, phone fallback, and shared web/bot updates.

Check production configuration handling, absence of mock success/availability,
approved copy/assets/contact/consent, metadata, keyboard interaction, secrets,
cache boundaries, logging, outbox recovery, and backup restoration where possible.
Verify Nest owns database/bot/session operations; web and bot mutations share its
services. Check separate application startup/restarts, API-down form behavior,
same-origin cookie/logout/CSRF behavior, and absence of backend secrets in Next.js.
Do not mark real bot delivery, restored backups, or performance as verified if
the required environment/accounts were unavailable.

Update README and implementation documentation to describe the actual app,
commands, contracts, setup, and remaining launch blockers. Provide a concise
Russian release-readiness report with changed files, checks, and manual steps.
Prepare a concrete reviewable release; deployment is a separately authorized step.
```

## Optional later feature prompt

```text
Implement only the explicitly selected roadmap feature: [FEATURE].
Read the current specification, actual code/contracts, and all relevant callers.
Confirm the feature's prerequisite business rules and external integration evidence.
Reuse Nest booking/authorization/notification services and the Next.js UI/API client.
Keep unrelated roadmap features out of scope. Add the smallest meaningful check
for the new behavior, update actual setup/contracts, and summarize in Russian.
```

Replace `[FEATURE]` with one concrete approved item and its policy inputs before use.
