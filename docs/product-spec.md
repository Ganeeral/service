# Product specification: U Ilyukhi Auto Service

Version: 0.6 draft. Updated: 2026-10-11. Selected stack: Next.js + NestJS + PostgreSQL.

Status: phase-one visual prototype implemented in `apps/web`; business inputs and production infrastructure remain unconfirmed. Phase-two NestJS persistence/API and shared scheduling/lifecycle operations now exist in `apps/api`; see [actual contracts and setup](backend-api.md). Phase-three form integration is implemented; see [form operation](booking-form.md). Public submission remains disabled pending approved consent/business inputs. Phase-four Telegram linking, private administration and basic durable delivery are implemented; see [bot setup](telegram-bot.md). Protected website owner dashboard and deployment remain pending. Editable legal drafts exist but operator/approval are unresolved; see [legal checklist](legal/release-checklist.md). Proposed later-phase contracts below remain design decisions.

## 1. Objective and scope

Build a visually polished, responsive landing page for the automotive service “У Илюхи”. Convert visitors into preliminary appointments by showing services, trustworthy information, contacts, and available intake windows. Deliver appointment notifications to the owner and, after linking, to the customer through one Telegram bot. Let the owner manage the same appointments and availability both in that bot and in a protected website dashboard.

Success means a visitor can understand the service, submit a valid request for a real free window, and learn whether the owner has confirmed it. The owner can manage this flow from a phone without editing the database.

### First release

- Landing page with hero, services, work process, trust information, appointment form, FAQ, and contacts.
- Actual free windows maintained by the owner; no fabricated availability.
- Form with contact, vehicle, service/problem, and selected window.
- Atomic preliminary booking with protection against duplicate submission and competing customers.
- Customer Telegram linking, status notifications, own appointments, and cancellation.
- Owner notifications, day/week lists, confirmation, cancellation/rejection, agreed rescheduling, completion/no-show, and slot administration.
- Protected website administration with the same appointment/slot actions, responsive calendar/list views, and notification failure visibility.
- Persistent data, durable notification retries, authorization, server validation, backups, and an operational failure view.

### Optional content for the first release

Real work photos, approved starting prices, verified reviews, master profiles, and a video can be included when supplied. Missing content must not block the core flow or be replaced with invented claims.

### Outside the first release

Online payments, repair order management, inventory, automatic repair duration estimation, a multi-location CRM, customer accounts with passwords, and a Telegram Mini App. Later features are described in section 14.

## 2. Roles and assumptions

| Role            | Allowed actions                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------ |
| Visitor         | View public content and free slots; submit an appointment                                        |
| Linked customer | Receive updates; view and cancel their own upcoming appointments                                 |
| Owner           | Manage all appointments and intake slots in the website dashboard and bot; see delivery failures |

Draft assumptions:

1. One shared intake queue is confirmed by the user. One location and one authorized owner are initial assumptions.
2. Website and Telegram administration are both confirmed by the user. Owner rights are assigned by numeric Telegram user ID, never by username or a public registration command. The web session must map to an authorized owner identity.
3. All UI dates use the service's configured IANA timezone. Kazan and `Europe/Moscow` are confirmed by the user. Persist timestamps in UTC.
4. Intake window length, minimum booking notice, booking horizon, working hours, and response expectation must come from the owner. Do not infer them from the reference image.
5. No payment or binding final repair price at submission. A preliminary appointment does not guarantee repair duration or parts availability.
6. A pending appointment occupies its window until an authorized transition releases it. Do not silently expire customer requests in the first release.
7. No-Telegram customers can submit; the owner handles confirmation by phone and records it in the bot. If Telegram must be mandatory, revise the flow explicitly before coding.

Technology decision confirmed by the user: Next.js for website interfaces, NestJS for the backend and Telegram bot, PostgreSQL for persistence, strict TypeScript, and one repository with separate web/API applications.

Multiple repair bays do not automatically mean multiple simultaneous intake appointments. Clarify how cars are actually received before changing capacity.

## 3. Visual direction from the reference

![User-provided landing reference](assets/landing-reference.png)

Use the reference for composition and mood. Its phone, address, opening hours, years of experience, guarantees, and other claims are placeholders, not verified service data.

### Direction

- Light, warm neutral background, almost-black text, dark graphite sections, restrained coral/orange accent.
- Large condensed headings and a readable body font with Cyrillic support. Reuse installed fonts; otherwise choose a locally served, properly licensed pair during setup.
- Real workshop and car photography, documentary mood, warm lights, clean crops. Avoid a generic luxury dealership aesthetic.
- Dark solid main CTA, restrained outlines, thin dividers, small radii, and clear spacing. Avoid glass effects, excessive gradients, and large decorative motion.
- Main image on the right of the desktop hero, readable text on the left. A light overlay can connect the two areas without hiding the workshop.
- Three service cards per row on wide screens, two on medium screens, one on phones where two would be cramped.
- Two contrasting panels for consultation/trust, followed by contacts and directions.

### Draft design tokens

| Token           | Draft value                     |
| --------------- | ------------------------------- |
| Page background | `#F5F5F2`                       |
| Main text       | `#171D1F`                       |
| Dark surface    | `#192124`                       |
| Accent          | `#EF765E`                       |
| Border          | `#DDE0DC`                       |
| Content width   | Approximately 1200 px           |
| Card radius     | 8–12 px                         |
| Spacing scale   | 4, 8, 12, 16, 24, 32, 48, 64 px |

These are starting values; verify contrast before finalizing them. Accent color is decorative unless text contrast passes.

### Page sections

| Section            | Content and behavior                                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Header             | Wordmark, section anchors, real phone, “Записаться”; accessible mobile menu                                            |
| Hero               | Short proposition, workshop photo, primary appointment CTA; video link only if a video exists                          |
| Trust strip        | Up to four owner-approved facts; omit unverifiable experience or guarantees                                            |
| Services           | Initial candidates: diagnostics, oil/maintenance, suspension, engine, brakes, electrical work; confirm actual services |
| Process            | “Оставьте заявку → Получите подтверждение → Приезжайте в сервис”; explain preliminary status                           |
| Work/about         | Real workshop, staff, specialization, and work examples if available                                                   |
| Appointment        | Step-by-step form, free windows, error/empty/success states                                                            |
| Prices/reviews     | Include only approved pricing and genuine attributed reviews with permitted use                                        |
| Consultation/trust | “Не знаете, что сломалось?” leads to the form with “Нужна диагностика” selected; phone as an alternative               |
| FAQ                | Confirmation, pricing, parts, timing, cancellation, and preparation; owner-approved answers                            |
| Contacts/footer    | Address, hours, call, directions, Telegram, privacy information, approved operator details                             |

Suggested hero copy, subject to approval:

> Больше, чем просто ремонт
>
> Обслуживание и ремонт автомобиля с понятным согласованием работ.
>
> Записаться в сервис

Do not publish statements such as “10 years of experience”, “guarantee on every job”, or “free consultation” until their exact meaning is approved.

### Responsive and accessible behavior

- Verify at 360, 390, 768, and 1440 px; no horizontal overflow or tiny form controls.
- On phones, stack the hero and keep the main CTA visible; a bottom appointment action must not cover content or the keyboard.
- Use an inline booking section as the default: simpler scrolling and mobile keyboard behavior than a large modal.
- Visible labels, keyboard operation, focus indicators, error summaries, adequate contrast, and practical touch targets of about 44 px.
- Loading states announce updates without repeatedly moving focus. Errors preserve entered fields.
- Use sentence case throughout the interface; do not force uppercase headings, labels, or branding. Omit decorative eyebrow labels and their dot above section headings, as requested by the user. Honor reduced-motion preferences. Use Framer Motion for the FAQ's opening/closing height, opacity, and toggle animation; keep other transitions brief and purposeful.
- Do not embed third-party maps on initial page load by default; show an approved location preview and a directions link. Do not present a fabricated map pin.

## 4. Customer booking journey

1. Visitor clicks “Записаться” or a service card. Scroll to the form and preselect that service.
2. Enter vehicle and service/problem details. “Не знаю / нужна диагностика” remains a first-class option.
3. Choose a date and one of its free intake windows. Show the service timezone and explain that this is the arrival window.
4. Enter name and phone, review the summary, and accept the approved data-processing consent.
5. Submit once. Server validates and reserves the window atomically; disable the button while submitting.
6. After database commit, show the appointment reference, requested time, and “Заявка получена. Время подтвердит администратор.” Never say “Запись подтверждена” at this stage.
7. Offer “Получать уведомления в Telegram”. Customer opens the bot link and presses Start to link this appointment.
8. Owner receives the new-request card, confirms it or contacts the customer to clarify/reschedule. Linked customer receives the result; for unlinked customers the owner calls.

### Booking form

Use a compact section heading above a full-width form card rather than a tall promotional side column. On wide screens, vehicle/task and intake time sit side by side, with contacts in a separate row below. Stack the groups on smaller screens and keep their logical DOM/tab order. Place the intake-versus-repair explanation next to the time controls. Preserve entered data, service preselection, the phone mask, optional Telegram contact, and honest prototype status during layout changes.

The user requested a custom animated service dropdown. Use the existing Framer Motion for the panel and chevron, honoring reduced motion. Show service descriptions and the current selection. Keep a native select for form data/required validation, with invalid input focusing the visible combobox. Support arrows, Home/End, Enter/Space, Tab, Escape, and typeahead; fit the scrollable list within the viewport and close it on outside interaction. Follow the [WAI select-only combobox guidance](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/examples/combobox-select-only/) for focus and keyboard behavior, and manually verify assistive technology before launch.

| Field             | Required    | Rule                                                                                                                                                      |
| ----------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name              | Yes         | Trimmed, 2–80 characters; no overly restrictive alphabet rule                                                                                             |
| Phone             | Yes         | `type="tel"`, preserve original input and normalize server-side; accept the approved countries, reject invalid numbers; no Telegram username substitution |
| Telegram username | No          | User-requested optional contact tag; accept with or without `@`, trim and display one leading `@`; it is not a verified identity or a writable bot chat   |
| Vehicle make      | Yes         | Free text, 1–60 characters; do not require a large vehicle catalog                                                                                        |
| Vehicle model     | Yes         | Free text, 1–80 characters                                                                                                                                |
| Vehicle year      | No          | Integer from 1900 to current service-local year + 1                                                                                                       |
| Service           | Yes         | One enabled catalog entry or the explicit diagnostics/unknown option                                                                                      |
| Problem/request   | Conditional | Required for unknown service; otherwise optional; maximum 2000 characters                                                                                 |
| Date and window   | Yes         | Real published slot, not past, within configured notice/horizon                                                                                           |
| Mileage           | No          | Optional nonnegative integer with a reasonable documented upper bound                                                                                     |
| Consent           | Yes         | Explicit unchecked checkbox with approved linked notice; persist notice version and timestamp                                                             |

Do not ask for VIN, number plate, postal address, email, or passport data by default. Add VIN/plate only if the owner explains a concrete need. Vehicle photos and attachments belong to a later phase.

The current prototype has a live `+7 (999) 123-45-67` phone mask, accepts local ten-digit input or leading `7`/`8`, and checks completeness in the browser. This does not implement production phone validation or establish the supported countries. Add country selection/normalization when those countries are approved. The Telegram field is for manual contact only; the existing bot-start/linking requirements remain mandatory for notifications. In the connected phase-three form, contacts are submitted only after review and explicit consent. The optional tag remains unverified.

Draft placeholder for the problem field: “Что нужно сделать? Например: заменить масло, проверить стук спереди, разобраться с ошибкой на панели.”

### Required form states

| State                       | Customer experience                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| Loading availability        | Skeleton or short loading message; no fake selectable slots                                |
| No free windows             | “На эту дату свободных окон нет”; nearby dates and real service phone                      |
| Availability unavailable    | Retry and phone alternative; distinguish failure from a fully booked day                   |
| Selected slot was taken     | Preserve form, refresh windows, ask for another time                                       |
| Invalid input               | Inline explanation and focus on the first invalid field                                    |
| Network timeout             | Keep draft and submission key; retry the same request, do not create a second appointment  |
| Saved, Telegram delayed     | Keep success; show linking option and phone contact; no claim that a message was delivered |
| Bot not started             | “Чтобы получать сообщения, откройте бота и нажмите «Старт»”                                |
| Bot blocked or link expired | Recovery instructions and phone fallback; no lost appointment                              |

The public site does not expose bookings by phone number or sequential booking reference. Any private status page would require its own scoped access design; it is not included in the first release.

## 5. Scheduling and appointment lifecycle

### Window model

The owner publishes discrete intake windows for particular dates. Each window has a start, end, and publication flag. Window length, minimum notice and horizon are owner-editable PostgreSQL settings through the private Telegram `/settings` menu; environment defaults initialize them once in migration 4. Duration changes affect new windows; existing slots/appointments are preserved. The length is an approved configuration value, not a calculated repair duration. One active appointment per window.

- Only enabled future windows meeting booking notice/horizon rules are public.
- Publishing supports creating a single window or a date's non-overlapping sequence from explicit start/end/interval inputs.
- Duplicate and overlapping windows are rejected. Enforce this transactionally for the one shared calendar, not only in the bot UI.
- The owner can hide a free window or close a date to new bookings. Existing appointments remain visible and require explicit cancellation/rescheduling.
- Phone/walk-in appointments can be added by the owner using the same reservation rules, with `source=manual` and no fictitious customer Telegram identity.
- A selected window is not held while the customer fills the form. It is claimed on submission; stale selections can conflict.
- Pending/confirmed records block a window. Rejection/cancellation releases a future window only if it is still published and meets booking rules.
- Do not generate real production availability from sample opening hours.

### Status transitions

| Current status  | Allowed next status | Actor and requirement                                   |
| --------------- | ------------------- | ------------------------------------------------------- |
| `pending`       | `confirmed`         | Owner; confirmation is explicit                         |
| `pending`       | `rejected`          | Owner; customer-facing reason required                  |
| `pending`       | `cancelled`         | Owner or linked customer; cancellation confirmation     |
| `confirmed`     | `cancelled`         | Owner or linked customer; cancellation confirmation     |
| `confirmed`     | `completed`         | Owner; after arrival time                               |
| `confirmed`     | `no_show`           | Owner; after arrival time                               |
| Terminal status | None                | No silent reopening; create a new appointment if needed |

Cancellation by customers is allowed before the window starts in the draft policy; later changes require contacting the service. Owner corrections after arrival remain audited. Cancellation reason is mandatory for owner-initiated cancellation and optional for customers.

Rescheduling is an audited change of the window for a `pending` or `confirmed` appointment, not a separate persistent status. Owner first agrees the new time with the customer, selects a free target, reviews old/new times, and confirms the change. Transfer the reservation and release the original window in one transaction; preserve status. If the target is taken, leave the original untouched. Send a new-time notification after commit.

Record status/window changes with actor, time, old/new values, and a reason where applicable. Repeated or stale actions return the current state without an extra transition or extra notification event.

An overdue pending request is highlighted to the owner after the approved response threshold; it does not disappear or automatically release its window.

## 6. Telegram customer experience

Bots cannot initiate a private conversation with an arbitrary person. The customer must start the bot first; a submitted phone number does not provide a writable Telegram chat. [Telegram bot introduction](https://core.telegram.org/bots).

Use a private deep link with an opaque `start` payload. Telegram documents a maximum payload length of 64 characters and a restricted character set. [Telegram deep linking](https://core.telegram.org/bots/features#deep-linking).

### Safe linking

- After a saved website appointment, issue a cryptographically random token with at least 128 bits of entropy, valid for a proposed 24 hours, scoped only to linking that appointment.
- Store its hash, expiry, and use marker. No phone, name, sequential booking ID, or admin permission in the token.
- Treat the link as a temporary capability for that appointment, not verification of the phone owner's identity. Avoid exposing it to analytics, referrers, or logs.
- On private `/start`, atomically validate/consume the token and bind the appointment to the actual Telegram sender/chat ID from the trusted update.
- Replaying an already consumed token must not rebind ownership. A repeat by the same linked sender can safely show current status.
- Invalid/expired links disclose no appointment data. Expired-link recovery is handled through the owner with customer verification; no public lookup by phone.
- A customer may link several of their appointments. Every subsequent customer action checks that appointment's binding server-side.
- The bot shows the current status on late linking, even if the owner already confirmed the request. It must not replay obsolete “pending” messages.

### Customer menu

`/start`, `/help`, “Мои записи”, “Как добраться”, “Позвонить в сервис”. “Мои записи” shows only appointments linked to this Telegram user; do not infer all appointments sharing a phone number.

Appointment card: reference, vehicle, service, date/time, status, address, and a cancellation action if permitted. Cancellation asks for confirmation. Rescheduling requests in the first release direct the customer to call/contact the owner; self-service moves are deferred.

### Message examples

Preliminary request, after linking:

> Заявка №{reference} получена.
> {vehicle} · {service}
> Желаемое время: {date}, {time} ({timezoneLabel}).
> Администратор подтвердит запись. Пока время предварительное.

Confirmation:

> Запись №{reference} подтверждена.
> Ждём вас {date} в {time}.
> Адрес: {approvedAddress}.
> Если планы изменились, отмените запись в боте или позвоните: {approvedPhone}.

Cancellation/rejection and rescheduling must include the affected reference, clear status, approved reason or old/new time, and phone contact. Do not send marketing under the guise of appointment updates.

## 7. Telegram owner administration

Private-chat menu: “Новые заявки”, “Сегодня”, “Неделя”, “Свободные окна”, “Добавить запись”, “Проблемы уведомлений”, “Помощь”. Paginate long lists. Keep destructive or time-changing actions behind a compact confirmation screen.

### New-request card

Show reference, creation time, requested date/window, service, vehicle/year/mileage if supplied, problem, name, phone, source, current status, and customer Telegram linkage state. Mark unlinked customers “Telegram не подключён — связаться по телефону”.

Actions: “Подтвердить”, “Перенести”, “Отклонить”, “Отменить”; expose only actions legal in the current status. After confirmation show “Завершить” and “Не приехал” when permitted. Include the actual contact number as text; use a valid platform-supported link if implemented, not a made-up bot action.

### Availability management

1. Pick a date and view all published/hidden/occupied windows.
2. Add one window or generate a non-overlapping series from owner-provided times and interval.
3. Preview before publishing; show how many windows will be added and any collisions.
4. Hide a free window or close the date for new intake after confirmation.
5. If appointments exist, display them and require individual resolution; never silently delete them.

Owner cancellation/rejection asks for a brief customer-facing reason. Internal notes are separate and never included in customer messages. Manual appointment creation has explicit phone/name/vehicle/service fields and reserves a real window.

### Access and consistency

- Validate allowed owner user IDs and private chat context on every command, text continuation, and callback, even if the menu is hidden.
- Client-supplied callback data is untrusted. Reload the appointment and verify current state and actor before mutation.
- Deduplicate Telegram `update_id` durably; repeated updates do not repeat mutations.
- Bind multi-step admin input to the authorized user/chat, operation, and expiring session; retain sessions in durable storage so a process restart does not misapply a reason or date.
- Permit aborting a flow and require confirmation for a reschedule, cancellation, or date closure.
- Concurrent owner actions and website submissions share the same reservation function and transaction rules.

## 8. Website owner dashboard

The dashboard is part of the first release. It is a protected area separate from the public landing, with Russian labels and a layout usable on desktop and phone.

### Screens and actions

| Screen                | Required behavior                                                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Overview              | Counts of pending requests, today's visits, unlinked customers, and failed notifications; links into the relevant lists                 |
| Appointments          | Day/week view, chronological list on phones, status/date/reference/name/phone filters visible only to the owner, pagination             |
| Appointment detail    | Customer/vehicle/problem, Telegram linkage, status, history, internal notes, confirm/reject/cancel/agreed move/complete/no-show actions |
| Booking settings      | Set persisted intake duration, booking horizon and minimum notice; validate and confirm, reject stale overwrite                         |
| Availability          | Publish a window or a day's sequence, hide free windows, close a date, show occupied windows and conflicts                              |
| Manual booking        | Add a phone/walk-in appointment through the same validated reservation operation                                                        |
| Notification failures | See failed/delayed jobs, safe error summaries, customer phone fallback, controlled retry, and current delivery state                    |
| Session               | Visible owner identity and logout; no public self-registration                                                                          |

Use simple day/week controls and a list/grid; a drag-and-drop calendar library is unnecessary for one intake queue. Rescheduling uses explicit old/new time review and confirmation.

### Proposed owner login

For one owner already authorized in Telegram, use a short-lived one-time login link issued only by the private owner bot. This avoids maintaining a separate password system.

1. Owner opens the dashboard login screen and follows the bot entry, or requests “Войти в админку” from the authorized bot menu.
2. The server issues a random token with at least 128 bits of entropy, stores only its hash, scopes it to that allowed owner, and expires it after a proposed five minutes.
3. The NestJS bot handler sends the canonical HTTPS Next.js dashboard link. Carry the token in a URL fragment; the login UI removes it from browser history and submits it through a same-origin POST routed to NestJS. No token in logs, analytics, referrers, or persisted client storage.
4. NestJS atomically consumes the token once and creates a random server-side session in PostgreSQL. Return a host-only `Secure`, `HttpOnly`, `SameSite=Lax` cookie for the public origin, with path `/` and a proposed absolute 12-hour expiry. Do not maintain a second Next.js auth session.
5. NestJS verifies the active session and current owner allowlist on every protected read/mutation. Next.js protected server rendering also requires an authorized Nest API response. Logout revokes the stored session and clears the cookie; expiry or removed authorization requires a fresh login.

Treat the login link as a sensitive capability: anyone possessing it before consumption could sign in as that owner. Show “Не пересылайте ссылку” and provide session revocation. Do not claim that a login link provides multi-factor authentication. Login/consumption attempts are rate-limited. If the owner needs access when Telegram is unavailable, agree a separate recovery/login mechanism before adding it; never ship a hidden fallback password.

This is a proposed design to implement and verify, not an existing authentication service or route contract.

### Shared behavior and protection

- NestJS bot handlers and HTTP controllers call the same injectable reservation/status services. The Next.js dashboard calls the protected Nest API; no duplicated business rules or independent calendars.
- Website changes enqueue the same customer notifications as bot changes and refresh the owner bot card where possible.
- Refresh dashboard data after a mutation; revalidate on tab focus and show a manual refresh control. Real-time sockets are unnecessary initially.
- Protect mutations against CSRF/origin abuse, validate input, re-read current revision/state, and audit the owner and interface used.
- Never send owner/customer data in a public page response or a cache shared with other users. Hiding the menu is not access control.
- Handle expired sessions without losing a draft; reject stale actions cleanly and show the latest appointment state.
- Internal notes stay owner-only. Notification retries cannot bypass state/revision checks or resend obsolete appointment details.

## 9. Notifications and failure handling

### Event matrix

| Event                      | Owner                           | Linked customer                |
| -------------------------- | ------------------------------- | ------------------------------ |
| New website request        | Full request card               | Preliminary receipt after link |
| Customer links late        | Link state updated in card/list | Current appointment status     |
| Owner confirms             | Card refreshed                  | Confirmation                   |
| Owner rejects/cancels      | Card/list refreshed             | Reason and contact             |
| Agreed reschedule          | Card/list refreshed             | Old and new time               |
| Customer cancels           | Cancellation notification       | Cancellation receipt           |
| Delivery permanently fails | Failure view/health alert       | No false delivery claim        |

Saving an appointment and saving its required notification jobs must be one database transaction. Send messages only after commit. Use a small database-backed outbox, not an in-memory queue or a new message broker.

- Persist attempts, next retry time, recipient role/chat, appointment revision, provider result, and a safe error summary.
- Use bounded retries/backoff for timeouts, transient network failures, and rate limits; honor Telegram `retry_after`. Verify the webhook secret header against the configured secret. [Telegram Bot API](https://core.telegram.org/bots/api#setwebhook), [response parameters](https://core.telegram.org/bots/api#responseparameters).
- Treat a blocked/unavailable chat as a failed destination requiring phone fallback, not a booking failure.
- Deduplicate logical events in storage. Per-appointment delivery ordering or revision checks must prevent stale messages being sent after a newer status; a late link gets current state.
- Telegram calls are outside the booking transaction. A Telegram outage never rolls back an otherwise saved request.
- A provider timeout may occur after a message was accepted. Do not promise exactly-once delivery; duplicates can occur on retry. Include a stable booking reference so they are recognizable.
- Successful API response means accepted by Telegram, not read by the person. Do not invent read receipts.
- The long-running NestJS process drains outbox jobs through a background provider initially. Persist durable claims/leases and recover after restart; an in-process trigger is only a wake-up mechanism, not job storage. Additional API instances must not process the same claim concurrently. Stop claiming during shutdown and recover abandoned work after lease expiry. No production dependence on timers in a Next.js request.
- If Telegram itself is down, its bot cannot be the only health alert. Provide platform health/error monitoring and a documented way to inspect failed jobs from the server.

Proposed healthy-system target: enqueue immediately and deliver initial owner messages within 60 seconds. Validate against the chosen deployment; this is not an external provider guarantee.

## 10. Implementation direction

The repository now contains the initial Next.js visual prototype and planning documents. The user selected Next.js + NestJS + PostgreSQL. Recheck it before each phase and preserve conventions already introduced within that stack.

### Applications and repository layout

Use one repository with two applications and strict TypeScript throughout:

| Target                       | Responsibility                                                                                                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web` — Next.js / React | Public landing, booking form, owner dashboard UI, page metadata, image optimization, and server rendering                                                      |
| `apps/api` — NestJS          | Public/protected HTTP API, validation, booking/scheduling services, authentication/authorization, Telegram integration, outbox processing, and database access |
| PostgreSQL                   | One durable data source for both website and bot operations; only NestJS accesses it                                                                           |

Both `apps/web` and `apps/api` exist in the npm workspace. Shared contract types may be introduced when actual API consumers need them; do not scaffold a generic shared package or export database entities to the frontend.

Keep ordinary Next.js landing content server-rendered; isolate browser state to interactive UI. [Next.js documentation](https://nextjs.org/docs/app/getting-started/server-and-client-components).

In NestJS, HTTP controllers handle requests and injectable providers contain shared application behavior. Use focused modules for actual domains such as appointments/scheduling, owner access, Telegram, and notifications; choose names/files during implementation rather than generating unused modules. [NestJS controllers](https://docs.nestjs.com/controllers), [providers](https://docs.nestjs.com/providers).

Owner HTTP authorization belongs in NestJS guards/session checks. Bot handlers separately verify the trusted update, actual sender, chat context, and resource ownership before calling a business service. [NestJS guards](https://docs.nestjs.com/guards).

Reuse installed styling, validation, DB, icon, and test tools before adding any. Start with CSS Modules, native HTML controls, and runtime APIs where adequate. NestJS is the selected backend framework, not a Telegram client library; initially use the Bot API directly unless an existing client library has a concrete benefit. ORM/query tooling remains an implementation choice, not an approved additional dependency. Select supported versions using official documentation during setup.

### Deployment and frontend/backend boundary

- Run Next.js and NestJS as separate processes. Keep NestJS as one application handling both HTTP and bot updates initially; a separate bot microservice is unnecessary for the current queue.
- Prefer one canonical HTTPS origin: route API traffic to NestJS and website traffic to Next.js using the chosen reverse proxy or development forwarding. The implemented local prefix is `/api/v1`, forwarded by Next.js; see [actual contracts](backend-api.md). Production routing remains a deployment input.
- Public form and owner UI call the actual Nest HTTP contracts. Next.js rendering may also call Nest server-to-server, with required session forwarding for protected data. Next.js does not write appointments to PostgreSQL or host bot/business handlers.
- NestJS owns the session store and sets/clears cookies through the public origin. Verify cookie forwarding, host/path behavior, origin/CSRF checks, and cache isolation. Only trust forwarded headers from configured infrastructure; do not allow arbitrary origins or spoofed proxy metadata.
- Keep database credentials, bot token, webhook secret, owner allowlist, and notification-processing configuration in NestJS. Next.js needs only frontend content and appropriate API addressing; no backend secret in `NEXT_PUBLIC_*` variables.
- Process the durable outbox inside the long-running Nest application initially. Select an available scheduling/lifecycle mechanism during implementation; do not add Redis or a broker for this release. Split a worker later if hosting or measured load requires it.
- Choose hosting that can supervise both processes and support PostgreSQL, HTTPS routing, graceful restarts, and health checks. Do not assume that a frontend serverless deployment also provides a persistent Nest process.
- Document actual per-application dev/build/start/test commands, environment ownership, proxy setup, database migrations, and restart/backup behavior once implemented.

### Proposed logical data model

This is a minimal planning model, not a finalized migration or public DTO contract.

| Entity                 | Minimum information                                                                                                                                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Service catalog        | Key, Russian label, enabled flag, description; approved price only if available                                                                                                                                       |
| Intake slot            | ID, UTC start/end, published flag; one shared calendar initially                                                                                                                                                      |
| Appointment            | Internal ID, public reference, slot ID, status, name, phone original/normalized, vehicle, service snapshot/key, problem, optional fields, source, consent version/time, Telegram binding if any, revision, timestamps |
| Appointment event      | Appointment ID, actor, operation, old/new status or slot, customer reason/internal note where relevant, timestamp                                                                                                     |
| Link token             | Token hash, appointment ID, expires/consumed timestamps                                                                                                                                                               |
| Notification job       | Event/recipient uniqueness, revision, payload or reference, state, attempts, retry/claim fields, provider message ID, sanitized failure                                                                               |
| Processed bot update   | Unique update ID and processing result/state                                                                                                                                                                          |
| Admin flow session     | Owner/chat, operation, scoped draft, expiry                                                                                                                                                                           |
| Owner login token      | Token hash, allowed owner ID, expiry/consumed timestamps                                                                                                                                                              |
| Owner web session      | Hashed opaque session ID, allowed owner ID, expiry/revocation timestamps                                                                                                                                              |
| Submission idempotency | Random request key, payload fingerprint, saved result; no public read access                                                                                                                                          |

Site business content can initially live in a typed configuration file. Do not build a CMS or full customer entity just to save a form. The production service must fail clearly when required configuration is missing.

### Reservation integrity

- Implement shared NestJS services for website booking, manual booking, cancellation, and rescheduling rules. HTTP controllers and bot handlers delegate to them; Next.js consumes their HTTP boundary.
- Enforce one active (`pending` or `confirmed`) appointment per slot through a database constraint, such as a partial unique index.
- Lock relevant slot rows within the transaction, re-read publication/time rules, and reserve only after validation. For moves, lock both slots in a stable order.
- Slot publication uses a serialized calendar transaction or a database range constraint to reject overlaps, including two simultaneous admin flows. Choose one mechanism, not both unless needed.
- Persist idempotency result with the appointment and outbox jobs. Same key/same payload returns the original result; same key/changed payload returns a conflict.
- A transport retry retains the key. A customer editing the request after a definitive validation/conflict result uses a new key.
- Do not rely on disabled buttons, a cached availability response, an application-memory mutex, or client-side checks for capacity safety.

PostgreSQL row locks are held until transaction end and serialize conflicting writes to the locked rows. [PostgreSQL locking documentation](https://www.postgresql.org/docs/current/explicit-locking.html).

### Server boundaries

Define concrete Nest controller routes and validated request/response schemas during backend implementation, then document their actual paths, error cases, and authentication requirements. Needed operations: list available slots without personal data, submit an appointment, receive authenticated Telegram updates, consume owner login tokens, manage/revoke web sessions, and access protected owner reads/mutations. Bot handlers call shared Nest providers directly; website requests reach them through Nest controllers. Outbox processing is internal initially; authenticate a drain endpoint if a later deployment actually needs one.

Keep Next.js Route Handlers or Server Actions limited to necessary UI forwarding if used. They must not duplicate reservation/state rules, create an independent owner auth store, or access the database. Validate runtime payloads at Nest boundaries even when both applications use TypeScript; compile-time types alone do not validate HTTP input.

The UI-only phase uses explicitly marked local fixtures; it must not invent fetch URLs or pretend fixtures are production data. Once real contracts exist, replace fixtures with the actual availability/submission operations.

### Configuration inputs

Production needs service name/contact/address/timezone, hours and scheduling parameters, approved services, database connection, bot token/username, owner Telegram IDs, webhook secret, canonical site/API addressing, trusted proxy/origin configuration, and approved consent notice/version. NestJS owns operational secrets, scheduling, sessions, and notification settings; Next.js owns public presentation content and API addressing. Define explicit ownership of any shared public business content to keep contact/timezone labels consistent. Worker authentication is needed only if an external drain entry point is introduced. Define exact environment names during implementation and provide per-application examples with placeholders only.

## 11. Security and data handling

- Validate and bound every server input, including phone, timestamps, service keys, Telegram text, and callback payloads. Normalize consistently.
- Rate-limit public submissions and link attempts with a persistence/hosting mechanism that works across instances; combine with a honeypot where useful. Add CAPTCHA only if observed abuse justifies it.
- Verify origin/CSRF protections where relevant to the chosen submission mechanism; authorize the outbox runner independently.
- Escape customer-provided text before Telegram formatting and HTML output. Never turn a problem description into executable markup or a bot command.
- Keep bot/database/worker secrets on the server and out of commits, browser bundles, analytics, screenshots, and logs.
- Public availability returns no customer data. Sequential display references are labels, not authorization credentials.
- Record necessary appointment data only; avoid logging names, phones, complete problem descriptions, and link tokens.
- Owner must approve the data operator information, privacy/consent content, retention/deletion policy, hosting region, and use of Telegram for notifications before release. This specification does not assert legal compliance. Separate editable [legal drafts](legal/release-checklist.md) now exist and require actual operator inputs and approval.
- Protect backups and test restoration. Define who can access production data and how customer deletion requests are handled.

## 12. Quality and operational requirements

- Responsive, accessible Russian UI with no misleading prices/reviews/availability.
- Basic SEO: approved title/description, canonical URL, Open Graph image, sitemap/robots, correct business structured data only for verified fields.
- Optimize image sizes and layout stability; lazy-load below-fold images and avoid heavy hero video/autoplay.
- Performance targets to verify: LCP at most 2.5 s and CLS at most 0.1 in a representative mobile audit; production field performance must be measured after traffic exists.
- Useful loading/empty/error/success states, no data loss after form errors, and no backend secrets in the browser.
- Logs/health indicators for failed booking writes, outbox backlog, retry exhaustion, invalid webhook requests, and backup failure, without personal-data dumps.
- Availability responses must not serve stale cross-request cached data as authoritative. Submission always revalidates.
- Database migrations, worker/webhook setup, restart behavior, and backup/restore steps must be documented with actual commands once implemented.

## 13. Acceptance criteria

| ID  | Verifiable result                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A01 | Landing follows the reference's light/dark hierarchy, condensed hero, photography, and service grid; works at the four specified widths                                                          |
| A02 | Every CTA works; a service card preselects the correct service; optional sections disappear cleanly when content is absent                                                                       |
| A03 | Required/conditional fields validate on client and server; unknown service requires a problem description                                                                                        |
| A04 | Only real published eligible slots appear; empty availability and provider/database failure have distinct states                                                                                 |
| A05 | Two simultaneous submissions for one slot create exactly one active appointment; the loser sees a conflict and retains the form                                                                  |
| A06 | Retrying one submission key creates one appointment and one logical notification set; changed payload with the same key is rejected                                                              |
| A07 | Initial success is explicitly preliminary; owner confirmation changes status durably                                                                                                             |
| A08 | Valid bot linking binds only that appointment; expired/replayed/foreign capabilities cannot disclose or rebind another booking                                                                   |
| A09 | Unlinked customers stay booked; owner sees phone fallback; website never claims a Telegram message was delivered without evidence                                                                |
| A10 | Unauthorized bot senders, stale callbacks, wrong chat context, and duplicate updates cause no unauthorized or duplicate mutations                                                                |
| A11 | Owner can publish/hide windows, close a date, add a phone booking, and review day/week lists; concurrent slot creation cannot overlap                                                            |
| A12 | Customer sees/cancels only linked own future appointments; cancellation releases an eligible slot and notifies owner                                                                             |
| A13 | Rescheduling to a taken slot preserves the original; successful agreed rescheduling moves capacity atomically and records old/new times                                                          |
| A14 | Rejection/cancellation has a clear reason; completed/no-show cannot be set before the arrival time                                                                                               |
| A15 | Telegram outage/restart does not lose appointments or jobs; recovery retries durable jobs and avoids obsolete status messages                                                                    |
| A16 | Secrets are absent from client output and logs; user text is safely rendered; consent version/time is recorded                                                                                   |
| A17 | Keyboard/focus/mobile form behavior is checked; approved phone/address/directions and privacy links work                                                                                         |
| A18 | Production configuration, real owner bot access, health checks, and a backup restoration are verified before launch                                                                              |
| A19 | Owner can manage the same bookings/windows from the website and bot; an action in either is visible in the other after refresh                                                                   |
| A20 | Owner login tokens expire and are single-use; protected reads/mutations reject guests, expired/revoked sessions, removed owners, and CSRF attempts                                               |
| A21 | Dashboard works on phones; concurrent web/bot actions cannot double-reserve, overwrite a newer state, or expose internal notes to customers                                                      |
| A22 | Next.js calls the documented Nest API; Nest owns database/bot/session access, and HTTP/bot paths share business services without duplicate reservation logic                                     |
| A23 | Separate web/API startup and restart are verified; same-origin proxying preserves session cookies/logout/CSRF protection, and API outage produces honest UI errors without false booking success |

Use the project's existing test runner if present. At minimum, retain runnable checks for reservation races/idempotency, access/linking, state transitions/rescheduling, and notification recovery. Do not create a large suite of tests that only mirrors static markup.

## 14. Additional functionality and priorities

These items are a roadmap, not implicit first-release commitments. Add them when their business trigger is real.

| Priority | Feature                                    | Benefit and prerequisite                                                                                    |
| -------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| P1       | Appointment reminders                      | Reduce no-shows; approved timing, durable scheduling, linked customer, cancellation suppression             |
| P1       | Customer-requested/self-service reschedule | Reduce calls; define owner approval, cutoff, and slot reservation rules first                               |
| P1       | Waitlist                                   | Fill cancellations; customer opt-in, expiry, fair order, and a real offer/hold policy                       |
| P1       | Customer photo/video attachments           | Better preliminary diagnosis; file limits, safe storage, retention, and owner capacity to review            |
| P1       | Post-visit review request                  | Build genuine reputation; approved destination, quiet hours, opt-in where applicable                        |
| P1       | Real work gallery and before/after cases   | Strengthen trust; actual photos and permission, no fabricated cases                                         |
| P1       | Weekly operational summary                 | Pending/confirmed/cancelled/no-show counts; distinguish request volume from completed visits                |
| P2       | Multi-post/master scheduling               | Parallel intake when actually needed; resource capacity, service compatibility, overlaps, buffers           |
| P2       | Telegram Mini App / advanced calendar UI   | Faster calendar editing at higher volume; keep existing authorization and shared reservation rules          |
| P2       | SMS fallback                               | Reach customers without Telegram; provider, cost, consent, delivery failures, verified integration contract |
| P2       | Deposits and cancellation policy           | Reduce costly no-shows; payment provider, refunds, business/legal policies                                  |
| P2       | Customer service history                   | Easier repeat visits; identity verification, data lifecycle, actual visit records                           |
| P2       | Repeat-maintenance reminders               | Encourage regular maintenance; verified mileage/intervals and separate communication preferences            |
| P2       | CRM/calendar integration                   | Avoid duplicate administration; existing system/API evidence and conflict ownership rules                   |
| P2       | Price estimate request                     | Set expectations; approved price logic and explicit nonbinding estimates                                    |
| P3       | Loyalty, referral codes, promotions        | Only after repeat traffic and a defined offer; separate marketing preferences                               |

Do not add automatic diagnosis, AI chat, inventory, accounting, or a parts store merely to make the landing appear more advanced.

## 15. Delivery sequence

1. Confirm owner inputs and any changes to the draft assumptions.
2. Establish the web application target and build a Next.js visual landing with a clearly labeled booking prototype from the reference.
3. Establish the NestJS API application and implement PostgreSQL persistence, scheduling/state services, validated HTTP contracts, and web/API development routing.
4. Connect the Next.js form to the real Nest API and implement Telegram linking/owner administration inside NestJS.
5. Implement Nest-owned owner sessions and the protected Next.js dashboard consuming the same backend.
6. Add Nest outbox processing and operational setup for both processes and the database.
7. Run acceptance checks with real test bot accounts, approve content, and prepare release.

Each stage must produce reviewable working output and a brief Russian summary of changed files, checks, and manual verification. A visual prototype alone does not complete the product.
