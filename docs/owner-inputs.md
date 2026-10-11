# Owner inputs and launch checklist

Use this checklist with Ilyukha before production implementation and launch. No answers below should be inferred from the reference image.

## Confirmed by the user

| Decision                         | Answer                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------ |
| Administration                   | Both the Telegram bot and a protected website dashboard                              |
| Intake capacity                  | One shared intake queue                                                              |
| Technology                       | Next.js website + NestJS backend/bot + PostgreSQL, strict TypeScript, one repository |
| Design direction                 | User-provided automotive-service landing reference                                   |
| Booking type                     | Preliminary appointment followed by owner confirmation                               |
| City and timezone                | Kazan, `Europe/Moscow`                                                               |
| Telegram bot / authorized owner  | `@ilyxa_service_bot` / `733375528`                                                   |
| Booking configuration            | Private Telegram admin; PostgreSQL settings shared with the website                  |
| Remaining public contact content | User-authorized labeled demo content until actual data is supplied                   |

The last booking interpretation follows the original request for preliminary-booking notifications. Scheduling details and final policies still need owner approval.

## 1. Business and contact details

- Public brand name and spelling: “У Илюхи” or an approved alternative.
- Kazan is confirmed. Supply actual address, map/directions URL and entry/parking instructions; timezone is `Europe/Moscow`.
- Public phone, who answers it, and approved Telegram contact.
- Opening hours by weekday, breaks, holidays, and exceptions.
- Actual legal operator details and who approves privacy/data-processing documents.
- Domain ownership, preferred domain, hosting account, budget, and person responsible for renewal.

## 2. Services and pricing

- Which services are actually offered? Confirm diagnostics, maintenance/oil, suspension, engine, brakes, and electrical work individually.
- Which makes/types of vehicles are accepted? Any exclusions?
- Does the workshop service electric/hybrid cars, diesel, commercial vehicles, or only certain brands?
- Which jobs require prior discussion, parts availability, or a different appointment process?
- Are starting prices published? Specify whether parts are included and when the final estimate is approved.
- Are diagnosis or consultations chargeable? Do not publish “free” by assumption.
- Are guarantees offered? Supply exact approved wording and conditions.
- What experience/qualifications can be stated publicly?

## 3. Booking and queue policy

| Question                                                                                                                           | Owner answer |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| How long is one vehicle intake window?                                                                                             | TBD          |
| At what times can vehicles be received? Are intake hours different from opening hours?                                             | TBD          |
| How far ahead can customers book?                                                                                                  | TBD          |
| What minimum notice is needed before arrival?                                                                                      | TBD          |
| Who confirms requests and how quickly during working hours?                                                                        | TBD          |
| What should happen if a request remains pending too long? Draft: owner warning, no silent cancellation.                            | TBD          |
| What is the cancellation cutoff? Draft: before the window starts.                                                                  | TBD          |
| Must the customer use Telegram? Draft: optional, phone fallback.                                                                   | TBD          |
| Does the owner need web login while Telegram is unavailable? Draft: new logins require Telegram; existing valid sessions continue. | TBD          |
| Are there other employees who need owner access?                                                                                   | TBD          |
| Which phone countries/formats must be accepted?                                                                                    | TBD          |
| Is vehicle year/mileage useful? Draft: optional.                                                                                   | TBD          |
| Is VIN/plate actually needed before arrival? Draft: omit.                                                                          | TBD          |
| Should owners notify each other of website status changes in addition to refreshing bot cards?                                     | TBD          |

A free intake window means the car can be received, not that every repair fits into that window. Confirm this wording with the owner.

## 4. Visual content

- Logo/wordmark and any existing brand colors.
- Real exterior/workshop photos for hero and directions.
- Service photos, team photos, and work examples with permission to publish.
- Approved photos/captions and optimization rights; do not use the reference as proof of the actual workshop's appearance.
- Real reviews, sources, permission/use policy, and any approved review links.
- Video only if there is a suitable actual video.
- Short owner story, differentiators, and FAQ answers.

Until content is ready, development may use clearly labeled placeholder media. Public release must not imply a stock/generated workshop is the real premises or display fake reviews, prices, guarantees, or contact data.

## 5. Infrastructure and access

- The bot `@ilyxa_service_bot` already exists. Approve its Russian description and avatar; configure its token privately.
- Store the token through the chosen secret mechanism; never paste it into documentation or commit it.
- Provide the numeric Telegram user IDs permitted to administer the service. Each owner starts the bot privately.
- Approve canonical HTTPS site URL, PostgreSQL, hosting region, backup storage, and log access. Hosting must supervise separate Next.js and long-running NestJS processes.
- Plan same-origin routing to the website and Nest API, trusted proxy headers, and secure owner-cookie forwarding. Record actual addresses/routes after implementation.
- Keep database credentials, bot token, webhook secret, owner authorization, and notification settings in NestJS; frontend content/API addressing belongs to Next.js. Do not expose backend secrets through public web environment variables.
- Configure the webhook secret in NestJS. The outbox drain runs internally in the Nest process initially; configure worker authentication only if an external drain entry point is introduced.
- Confirm session lifetime and one-time Telegram-issued web login policy; the draft uses 12-hour sessions and five-minute links.
- Define data retention/deletion, who receives customer details, and who maintains service content.
- Provide owner-approved operator/privacy/consent notices, their version, and any communication preferences required by the selected policy.
- Define how bookings are handled during an outage and who monitors failures.

Do not request actual secret values in a public issue, prompt, or committed file.

## 6. Review the prototype

1. Open the page at 360, 390, 768, and 1440 px. Review the hero, photos, typography, service cards, contrast, and spacing against the reference.
2. Use every CTA and navigation link. Confirm service selection and that phone/directions point to the real service.
3. Fill the form on a phone, including opening the keyboard, changing dates, errors, and returning from Telegram.
4. Try “Не знаю / нужна диагностика” and verify it asks for the problem description.
5. Confirm preliminary wording and the Telegram Start instruction. Verify no demo data is presented as real availability.
6. Review the web dashboard on desktop and phone: list/calendar, detail, notes, filters, time-change confirmations, and logout.

## 7. Verify the integrated product

1. Publish test windows as the owner. Verify they appear on the website; hidden/past windows do not.
2. Submit a website appointment. Confirm one persisted request, a preliminary success screen, and the owner's notification.
3. Start the bot from the customer link. Verify the matching appointment and customer receipt. Confirm as the owner and verify the customer message.
4. Submit without starting the bot. Confirm the request remains valid and both owner interfaces show phone fallback.
5. Confirm before the customer links; link later and check that the customer sees the current confirmed status.
6. Use two browsers to submit the same window concurrently; one succeeds and the other keeps its form and receives a conflict.
7. Simulate a lost response and retry the same submission; verify there is one appointment and one logical notification event set.
8. Change a booking from the website, then inspect it in the bot; repeat in the opposite direction.
9. Cancel as the customer. Verify owner notification, updated dashboard, and correct slot release. Try cancelling another customer's appointment and a past appointment; both must fail.
10. Reschedule as the owner to a free window and to a taken one. Verify agreed time/history/notification and original preservation on conflict.
11. Add a phone booking. Try closing a day with existing requests; verify they are preserved and require explicit resolution.
12. Test unauthorized bot users and browser guests; verify no customer details or mutations are available.
13. Try expired/replayed login and customer-link tokens, stale callbacks, revoked sessions, and removed owner authorization.
14. Block the bot as a test customer, simulate Telegram/network failure, restart the worker, and inspect retries/failure visibility. No appointment is lost, and no obsolete message replaces a newer status.
15. Check special characters in the problem text, validation boundaries, consent version/time, and redacted logs.
16. Restore a test backup and verify both appointments and pending notification jobs.
17. Start/restart Next.js and NestJS separately; verify published slots, dashboard reads, and notification lease recovery. Stop the API temporarily and check that the form preserves input without claiming a saved appointment.
18. Through the actual same-origin proxy, check login cookies, protected server-rendered data, logout, expiry/revocation, and CSRF/origin rejection. Confirm Nest remains the authorization authority.
19. Inspect the web build/environment/logs for backend secrets and verify that only NestJS accesses PostgreSQL or handles Telegram updates.

## 8. Production release gate

- [ ] Real services, contacts, opening hours, prices/claims, and media approved.
- [ ] Scheduling parameters and timezone confirmed; real free windows published intentionally.
- [ ] Next.js form/dashboard use the actual NestJS API; no demo fixtures, fake success, or duplicate booking backend remain.
- [ ] Customer/owner Telegram accounts and protected web login verified.
- [ ] Reservation race, idempotency, access control, shared web/bot transitions, and notification recovery checks pass.
- [ ] Privacy/consent/operator content, retention, and Telegram use approved by the responsible owner/reviewer.
- [ ] Next.js and NestJS processes, same-origin HTTPS routing, trusted proxy/session configuration, backend secrets, PostgreSQL migrations, Nest webhook/outbox processing, health monitoring, and backups configured.
- [ ] Owner can inspect pending requests and failures, revoke sessions, and follow the outage runbook.
- [ ] Mobile/keyboard behavior, page metadata, image performance, phone, and directions manually checked.
- [ ] Release URL, rollback process, and maintenance responsibility recorded.

Publishing is a separate operational step; this planning package does not authorize or perform a deployment.

## Current launch decision (2026-10-06)

The user confirmed that approved privacy/consent documents do not exist yet. Keep `PUBLIC_BOOKING_ENABLED=false`. The connected form is implemented and tested with controlled data in isolated test schemas. Supply and approve actual operator/notice text and its URL/version before enabling real customer submission. No draft legal document is published as approved.

## Phase-four inputs (2026-10-06)

The user has an existing Telegram bot and will fill the secret configuration in local `apps/api/.env`; actual credentials and live delivery have not been verified. The legal operator/entity/country are not determined. Russian editable [privacy and consent drafts](legal/release-checklist.md) exist, with explicit placeholders; they do not change `PUBLIC_BOOKING_ENABLED=false`. The private bot and baseline durable worker are implemented and tested with synthetic accounts/transport. Protected website administration remains phase five. See [bot operation](telegram-bot.md).

## Booking settings and demo content (2026-10-11)

Bot username and owner allowlist are configured locally without exposing or replacing secrets. Live Telegram transport/webhook still requires explicit setup and testing. `/settings` lets the owner set window duration (5–240 minutes), booking horizon (1–365 days) and minimum notice (0–10080 minutes), with confirmation. These values persist across restarts, affect new availability/reservations and do not rewrite existing records. Initial migration values remain development defaults until the owner chooses actual policy. The “Свободные окна” menu now asks for a date; publish actual series with `/publish START END`, review, then confirm. Demo hours never create windows.

The landing uses Kazan plus `ул. Примерная, 12`, `+7 (000) 000-00-00` and `09:00–21:00` as explicitly labeled examples. The dummy phone cannot be dialed from the page and is not configured as the bot/booking fallback. Replace all three with approved business data before release. Legal entity, real address/phone/hours, approved notices, hosting and retention remain unresolved; public submission stays disabled.

Manual check after connecting a dedicated test environment: owner privately starts the bot, changes a setting and confirms it, reloads website booking options, creates real test windows, and verifies that both settings and existing appointments survive restart. Try a stale confirmation from a second owner and an unauthorized customer account.
