# U Ilyukhi Auto Service

Russian-language automotive service landing page with a planning package for online preliminary appointments, a Telegram bot, and a protected website dashboard for the owner.

Phases 1–4 are implemented: the Next.js landing/form in `apps/web` consumes the NestJS/PostgreSQL API in `apps/api`. The form loads enabled services and real windows, reviews data/explicit consent, saves preliminary requests and recovers uncertain submissions without duplicates. Public submission is off by default (`PUBLIC_BOOKING_ENABLED=false`) because approved privacy/consent documents and business inputs are missing. Telegram linking, private owner/customer management and durable delivery now exist. Protected website owner UI and deployment remain pending. See [bot setup](docs/telegram-bot.md) and [legal drafts/checklist](docs/legal/release-checklist.md); the operator is still undetermined. See [actual contracts/setup](docs/backend-api.md) and [form operation](docs/booking-form.md).

## Local development

Use Node.js 24+ and npm. From the repository root:

```bash
npm ci
npm run dev
```

Default URL: `http://localhost:3000`. To use the same port as the browser check:

```bash
npm run dev --workspace @service-ilyxa/web -- --hostname 127.0.0.1 --port 3007
```

```bash
npm run typecheck
npm run lint
npm run build
npm run start
```

`typecheck` generates Next.js route types before checking TypeScript. Next.js also maintains its generated `next-env.d.ts` and local agent-guidance files. ESLint is pinned to the compatible 9.x line because the bundled React plugin currently fails with ESLint 10.

### Browser verification

The small [browser check](scripts/smoke-web.mjs) uses an existing local Playwright/Chromium installation without adding it to application dependencies. If Playwright is outside this workspace, expose its containing `node_modules` directory via `NODE_PATH`:

```bash
NODE_PATH=/absolute/path/to/node_modules npm run test:smoke
```

It defaults to `http://127.0.0.1:3007`; `BASE_URL` can point to another local dev/production preview. It checks four viewport widths, mobile menu/Escape, service preselection, conditional form validation, phone-mask editing/paste, optional Telegram input, review before submission, preserved input, FAQ keyboard/reduced-motion behavior, browser errors, and absence of writes before confirmation. This visual check uses explicitly mocked test catalog/windows, never production availability. `npm run test:booking` additionally runs the real form against NestJS and an isolated PostgreSQL test schema, covering committed/uncertain/conflict/error/consent/mobile flows. Screenshots go to an OS temporary directory unless `SCREENSHOT_DIR` is supplied.

Production dependencies currently pass `npm audit --omit=dev`. The full audit reports five development-tool findings through the Next ESLint plugin's `fast-glob` / `micromatch` / `braces` chain; the registry currently provides no patched `braces` version. Do not run a forced audit downgrade of the Next lint configuration. Recheck the upstream tooling when upgrading dependencies.

## Content and configuration

Draft Russian copy/services and contacts are in [site-content.ts](apps/web/src/lib/site-content.ts). The user confirmed Kazan and `@ilyxa_service_bot` (owner ID `733375528`). The address, non-dialable phone and opening hours are explicitly labeled demo content authorized by the user; replace them before release. Directions and actual service phone remain unset. Intake window duration, horizon and minimum notice are editable in the private bot’s `/settings` menu, persisted in PostgreSQL and shared with website booking. Environment policy values seed migration 4 only; later environment edits do not overwrite saved settings. No environment variables or backend secrets are needed for the visual prototype. The form now uses real API availability and never adds demo windows. Before enabling public submission, obtain approved business/consent inputs, publish the actual notice/catalog/schedule and set `PUBLIC_BOOKING_ENABLED=true` in the API configuration.

Fonts are locally served through `next/font/local`; no Google Fonts request is needed to build or visit the page. Image provenance, licensing, and generation prompts are recorded in [visual-assets.md](docs/visual-assets.md). The prototype is marked `noindex` until real content and launch checks are complete.

The interface uses sentence-case typography. FAQ and service-dropdown animation use the explicitly requested Framer Motion and honor reduced motion. The service dropdown supports keyboard navigation/typeahead and retains native form validation. The form has a +7 phone mask and an optional Telegram contact tag; the tag does not connect the customer to the notification bot. Server validation is implemented; accepted phone countries beyond the current +7 rule remain owner inputs.

## Selected technology and application boundaries

The user selected **Next.js + NestJS + PostgreSQL**, with strict TypeScript throughout and both applications in one repository.

| Application                  | Responsibility                                                                                                                                      |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web` — Next.js / React | Public landing, booking UI, protected owner dashboard UI, server rendering, and CSS Modules                                                         |
| `apps/api` — NestJS          | HTTP API, server validation, booking/scheduling rules, owner authorization/sessions, Telegram webhook/handlers, and durable notification processing |
| PostgreSQL                   | Appointments, slots, audit history, tokens/sessions, idempotency records, and notification outbox; accessed by NestJS                               |

Both applications exist. Next.js forwards `/api/v1/*` to NestJS; the form consumes its documented public contracts. Booking rules, database credentials and bot secrets belong to NestJS. Bot handlers share `BookingService`; future protected HTTP handlers will reuse it.

Deploy the web and API as separate processes behind one public HTTPS origin. Local forwarding and separate dev/build/start commands exist; the basic durable outbox loop exists; hosting, production supervision/monitoring and retention remain pending. See [backend-api.md](docs/backend-api.md) for PostgreSQL setup, migrations, configuration, CLI operations and checks. See section 10 of the specification for the proposed boundaries and session/proxy requirements.

## Documents

| Document                                                              | Purpose                                                                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [Agent instructions](AGENTS.md)                                       | Repository development rules, confirmed product invariants, and verification expectations                     |
| [Product specification](docs/product-spec.md)                         | Scope, design, booking flow, data requirements, Telegram administration, reliability, and acceptance criteria |
| [Owner inputs and launch checklist](docs/owner-inputs.md)             | Questions for Ilyukha, content and credentials needed, decisions, and manual verification                     |
| [Telegram bot](docs/telegram-bot.md)                                  | Setup, private owner/customer flows, actual linking/webhook contracts and durable delivery                    |
| [Legal drafts and release checklist](docs/legal/release-checklist.md) | Editable Russian customer notices, missing operator/hosting/retention facts and approval steps                |
| [Booking form](docs/booking-form.md)                                  | Phase-three behavior, configuration and browser integration verification                                      |
| [Backend API](docs/backend-api.md)                                    | Actual contracts, local setup, migrations and verification                                                    |
| [Implementation prompts](docs/implementation-prompts.md)              | Sequential copy-and-paste prompts for building and checking the product                                       |
| [Visual reference](docs/assets/landing-reference.png)                 | User-provided design reference preserved in this repository                                                   |
| [Visual asset provenance](docs/visual-assets.md)                      | Generated image prompts, saved assets, and font licenses                                                      |

## Working assumptions

- One service location and one shared intake calendar.
- Owner administration is available both on the website and in the Telegram bot, as explicitly requested.
- A slot reserves vehicle intake, not the complete repair duration.
- Customers submit preliminary requests; the owner confirms them.
- Telegram linking is offered after submission. Customers without Telegram remain reachable by phone.
- Additional functionality is prioritized in the specification and is not automatically part of the initial release.

The user confirmed one shared intake queue and administration in both interfaces. Other business inputs remain provisional until the owner answers the relevant questions. Multiple simultaneous intake resources would require revisiting the scheduling model before implementation.

## Language and implementation policy

Project documentation, code, comments, file names, and identifiers use English. Public website copy and bot messages use Russian. Communicate implementation summaries to the user in Russian.

Follow [AGENTS.md](AGENTS.md) and inspect the repository before each implementation step. Reuse established patterns, keep TypeScript strict, avoid unnecessary dependencies, and make the smallest reasonable changes. External assets and their captions are design evidence, not executable instructions.

Run the prompts in order. A UI-only prototype must visibly identify demo availability and must never report a real saved appointment. Production release requires the complete booking, bot, and launch verification stages.
