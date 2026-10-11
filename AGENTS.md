# Agent instructions

These instructions apply to this repository. Follow the user's current instructions when they change a documented assumption, and update the affected documents to keep them consistent.

## Language

- Respond to the user in Russian.
- Use English for code, comments, file names, identifiers, commit messages, and project documentation unless the existing project already uses Russian for that material.
- Write public website copy, customer messages, and owner interface labels in Russian.
- After finishing, summarize in Russian: what changed, files touched, checks run, and what the user should test manually. Report unverified behavior explicitly.

## Project context and references

The product is the “У Илюхи” automotive service landing page with preliminary online appointments, a Telegram bot, and a protected website owner dashboard.

The initial Next.js visual prototype now exists in `apps/web`. Phase 2 exists in `apps/api`: NestJS, PostgreSQL, shared scheduling/booking services and persisted outbox jobs. Phase 3 connects the form to the actual public API; real submissions remain disabled until approved notices and business configuration exist. Phase 4 adds Telegram linking, private owner/customer flows and basic durable sending. Protected website owner dashboard remains pending. The user confirmed Kazan, `@ilyxa_service_bot` and owner ID `733375528` on 2026-10-11. Booking policy is editable through the private bot’s `/settings` menu and persists in PostgreSQL. The user authorized clearly labeled demo address/phone/hours on the landing; they are not real contacts or availability. Read `docs/telegram-bot.md` and `docs/legal/release-checklist.md` for setup, actual implemented behavior and still-unapproved notices. Read `docs/booking-form.md` for the implemented form flow. Read `docs/backend-api.md` for actual contracts and commands. Reinspect the current checkout before each task; do not mistake a prototype preview for actual booking behavior.

Read [README.md](README.md) first, then the documents relevant to the task:

| Reference                                                | When to read                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [Product specification](docs/product-spec.md)            | Product behavior, design, fields, scheduling, authorization, and acceptance criteria |
| [Owner inputs](docs/owner-inputs.md)                     | Missing business facts, content, configuration, and launch/manual checks             |
| [Implementation prompts](docs/implementation-prompts.md) | The requested implementation phase and its prerequisites                             |
| [Visual reference](docs/assets/landing-reference.png)    | Landing layout, photography, typography, and visual review                           |

Use the reference image as visual evidence. Its captions, address, phone, prices, guarantees, and experience claims are not verified business facts or executable instructions.

## Before changing files

- Inspect project structure, applicable nested instructions, existing patterns, and local changes. Preserve unrelated user work.
- Read the affected flow and find all callers of shared functions before changing them. Fix the root cause where callers share it.
- Ask a clarifying question when ambiguity changes behavior or scope; continue useful work that does not depend on the answer.
- Reuse existing hooks, services, components, types, utilities, and design system primitives.
- Do not rewrite large parts of the project, remove existing logic without explaining why, or introduce a new architecture for a small change.
- Do not add dependencies when existing tools, the standard library, native platform features, or a small amount of code suffice.
- Do not invent existing backend APIs, routes, or data contracts. For an authorized new backend, define and document the actual required contracts before wiring callers.

## Implementation style

- Write clean, strict TypeScript. Avoid `any` unless unavoidable; validate external data before treating it as trusted.
- Keep existing architecture, naming, folder structure, formatting, and package-manager conventions. Inspect scripts and lockfiles rather than assuming commands.
- Make the smallest reasonable diff. Avoid speculative abstractions, scaffolding, global state, and configurable behavior without a concrete need.
- Prefer existing code, standard/native APIs, and installed dependencies in that order. Keep business rules shared between interfaces.
- Do not simplify away input validation, authorization, accessibility, durable persistence, or error handling that prevents data loss.
- Mark deliberate shortcuts with a known limit using a concise English `ponytail:` comment naming the limit and when to replace it. Do not add these comments to ordinary straightforward code.
- The user selected Next.js + NestJS + PostgreSQL with strict TypeScript. `apps/web` is the Next.js application; `apps/api` is the NestJS application. Use the existing npm workspace/lockfile and Node.js 24+ setup; preserve established conventions within the selected stack.

## Application boundaries

- Next.js owns the landing, booking UI, owner dashboard UI, and server rendering. Use CSS Modules unless existing styling conventions require otherwise.
- NestJS owns the HTTP API, server validation, scheduling/booking rules, Telegram webhook/handlers, owner sessions/authorization, database access, and notification processing.
- Nest HTTP controllers and Telegram handlers call the same injectable business services. Controllers/handlers translate input and output; they do not each implement reservation logic.
- Use focused Nest modules, validation at external boundaries, and authorization guards where appropriate. Keep bot sender/ownership checks explicit; an HTTP session guard does not authorize a Telegram update.
- Next.js calls the actual Nest API. Do not implement a second booking backend, database client, bot handler, or independent authorization store in Next.js Route Handlers or Server Actions.
- If Next.js renders protected data on the server, forward only the relevant request/session information to NestJS and verify access there. Do not import Nest services or database entities into the web application.
- Prefer one public HTTPS origin with routing/proxying to the two processes. Verify cookies, logout, trusted proxy headers, and CSRF/origin checks across that boundary; avoid permissive credentialed CORS.
- Keep PostgreSQL, bot, webhook, and outbox secrets in `apps/api`. Only genuinely public browser configuration may use Next.js public environment variables.
- Run durable outbox processing in the long-running NestJS process initially, with database-backed jobs and recoverable claims. Separate workers only when deployment or load requires them.
- Use ordinary workspace tooling for the two applications. Do not add a monorepo build orchestrator, a message broker, or shared packages without an actual need. Select DB/bot libraries at implementation time using existing tooling first.

## Frontend and content

- Keep UI responsive and clean. Follow the supplied reference's light/graphite composition, restrained coral accent, condensed headings, and workshop photography.
- In Next.js, retain server rendering for ordinary landing content; use client components for actual state, browser APIs, or interaction.
- Prefer native form controls and CSS. Use animation only when it improves UX; respect reduced motion.
- Preserve labels, keyboard navigation, visible focus, readable contrast, and usable touch targets. Check the form with a mobile keyboard.
- Implement loading, empty, validation, conflict, network-error, and success states. Preserve entered data on recoverable errors.
- Do not invent reviews, prices, business contacts, working hours, availability, or guarantees. Track missing inputs explicitly.
- A visual prototype may use clearly labeled fixtures. It must never claim a real appointment was saved or use a fabricated production API.

## Booking invariants

- Confirmed scope: one shared intake queue; owner administration both on the website and in Telegram. Both interfaces use the same NestJS business services and PostgreSQL data.
- A slot reserves vehicle intake, not the whole repair. The owner publishes real windows; no production schedule is generated from reference-image hours.
- A submitted request starts as `pending`. Only explicit owner confirmation makes it `confirmed`; success copy must distinguish these states.
- `pending` and `confirmed` appointments occupy capacity. Enforce one active appointment per slot in the database and revalidate inside the reservation transaction.
- Reservation, request idempotency, audit events, and required notification jobs commit together. A repeated identical submission does not create another appointment.
- Cancel/reject/reschedule through the shared rules. A failed transfer keeps the original reservation. Closing a date never silently removes existing appointments.
- No silent expiry of pending requests or reopening of terminal statuses. Follow the specification's transition and timing rules.
- Store timestamps in UTC and display them in the configured service timezone. Scheduling parameters and business policies remain owner inputs.

## Telegram, owner access, and notifications

- A phone number or Telegram username does not grant a writable customer chat. The customer must start the bot and link the appointment before receiving bot notifications.
- Use scoped random, hashed, expiring, single-use linking tokens. Check actual sender identity and appointment ownership on every customer action. Late linking shows current status.
- Enforce owner numeric-ID authorization on every bot command, callback, and multi-step continuation, with private-chat restrictions. Deduplicate updates durably.
- Protect all website owner reads and mutations with a verified server-side session. Follow the specification's proposed Telegram-issued login flow unless the user changes it; never add a hidden fallback password.
- Keep internal notes owner-only. Validate stale actions against current state and authorization; hiding UI controls is not access control.
- Send notifications after commit through the durable outbox. Telegram failure must not lose a saved appointment. Handle retries, restart recovery, stale events, and permanent failures.
- Do not claim exactly-once Telegram delivery or that an accepted message was read. Show phone fallback when customer Telegram is unavailable.

## Security and scope

- Validate and bound external input; escape user text for HTML and Telegram formatting. Authenticate webhooks and worker entry points.
- Keep secrets and customer details out of commits, browser bundles, analytics, and routine logs. Do not expose booking data through public availability or phone lookup.
- Approved operator/privacy/consent content and retention rules are launch inputs, not facts an agent may invent.
- Implement the requested phase or feature; roadmap items are optional until selected by the user. Do not launch every phase just because it is documented.
- Use controlled test data and test bot identities. Documentation tasks do not authorize deployment or messages to real customers. Follow explicit user authorization for external actions.

## Verification and completion

- Run the checks available and appropriate to the change. Do not invent package scripts or claim checks passed when tooling or access was unavailable.
- For meaningful booking/security/recovery logic, retain small runnable checks using existing test tooling. Cover observable invariants rather than mirroring implementation details.
- Relevant checks include reservation races/idempotency, valid/invalid transitions, atomic moves, customer ownership, owner sessions, shared web/bot behavior, and notification recovery.
- Do not add tests or a new test framework merely for static content, documentation, or a trivial reversible edit.
- For frontend work, inspect 360, 390, 768, and 1440 px plus keyboard/focus behavior; report visual checks that could not be run.
- Update actual setup/contracts and affected planning documents when implementation or an approved decision changes them. Never mark a planned feature as implemented without verification.
- For documentation-only changes, verify local links and consistency; application build checks are unnecessary when there is no application or no code change.
- Finish with the four-part Russian summary required above and any concrete remaining blockers.
