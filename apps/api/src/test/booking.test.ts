import "reflect-metadata";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { HttpException } from "@nestjs/common";
import { Pool } from "pg";
import { BookingService } from "../booking.service";
import { Config } from "../config";
import { Database } from "../database";
import { createApplication } from "../app";

const key = () => randomBytes(32).toString("base64url");
const operator = { kind: "operator", id: "local-cli" } as const;

async function rejects(operation: Promise<unknown>, code: string) {
  await assert.rejects(
    operation,
    (error: unknown) =>
      error instanceof HttpException &&
      (error.getResponse() as { code: string }).code === code,
  );
}

test("durable booking, race, lifecycle and HTTP invariants on isolated PostgreSQL", async () => {
  const testUrl = process.env.TEST_DATABASE_URL;
  assert.ok(
    testUrl,
    "Set TEST_DATABASE_URL explicitly; tests never use DATABASE_URL",
  );
  const url = new URL(testUrl);
  assert.match(
    url.pathname,
    /_test$/,
    "Only a dedicated database ending in _test is accepted",
  );
  const admin = new Pool({ connectionString: testUrl, max: 1 });
  const schema = `booking_test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  url.searchParams.set("options", `-c search_path=${schema}`);
  const config = new Config({
    DATABASE_URL: url.href,
    NODE_ENV: "test",
    PUBLIC_BOOKING_ENABLED: "true",
    PUBLIC_ORIGIN: "http://127.0.0.1:3007",
    SERVICE_TIMEZONE: "Europe/Moscow",
    BOOKING_NOTICE_MINUTES: "60",
    BOOKING_HORIZON_DAYS: "30",
    INTAKE_WINDOW_MINUTES: "30",
    CONSENT_VERSION: "test-v1",
    CONSENT_NOTICE_URL: "http://127.0.0.1:3007/test-consent",
    OWNER_TELEGRAM_IDS: "111",
  });
  const db = new Database(config);
  const booking = new BookingService(db, config);
  let app: Awaited<ReturnType<typeof createApplication>> | undefined;
  const tomorrow = new Date(Date.now() + 48 * 60 * 60 * 1000);
  tomorrow.setUTCMinutes(0, 0, 0);
  const at = (offset: number) =>
    new Date(tomorrow.getTime() + offset * 30 * 60 * 1000).toISOString();
  const day = (iso: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: config.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  const input = (slotId: string) => ({
    slotId,
    name: "Test Customer",
    phone: "8 (999) 123-45-67",
    make: "Test",
    model: "Vehicle",
    serviceKey: "unknown",
    problem: "Test diagnostics only",
    telegramUsername: "@test_contact",
    consent: { accepted: true, version: config.consentVersion },
  });
  try {
    await db.migrate();
    await db.migrate();
    assert.equal(
      (await db.pool.query("SELECT * FROM schema_migrations")).rowCount,
      4,
    );
    assert.deepEqual((await booking.options()).services, []);
    await booking.configureService(
      "unknown",
      "Тестовая диагностика",
      true,
      operator,
    );
    await booking.configureService(
      "maintenance",
      "Тестовое ТО",
      true,
      operator,
    );
    await rejects(
      booking.configureService("engine", "Test", true, {
        kind: "owner",
        id: "222",
      }),
      "FORBIDDEN",
    );
    const slots = await booking.publishWindows(at(0), at(8), operator);
    const ids = slots.map((slot) => slot.id);
    const counts = async () =>
      (
        await db.pool.query<{
          appointments: number;
          events: number;
          jobs: number;
          requests: number;
        }>(
          "SELECT (SELECT count(*)::integer FROM appointments) AS appointments, (SELECT count(*)::integer FROM appointment_events) AS events, (SELECT count(*)::integer FROM notification_jobs) AS jobs, (SELECT count(*)::integer FROM submission_requests) AS requests",
        )
      ).rows[0]!;

    // Different request capabilities racing for one slot have one winner.
    const race = await Promise.allSettled([
      booking.submit(input(ids[0]!), key()),
      booking.submit(input(ids[0]!), key()),
    ]);
    assert.equal(
      race.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const losing = race.find((result) => result.status === "rejected");
    assert.ok(
      losing?.status === "rejected" && losing.reason instanceof HttpException,
    );
    assert.equal(
      (losing.reason.getResponse() as { code: string }).code,
      "SLOT_UNAVAILABLE",
    );
    assert.deepEqual(await counts(), {
      appointments: 1,
      events: 1,
      jobs: 2,
      requests: 1,
    });
    const winner = race.find((result) => result.status === "fulfilled");
    assert.ok(winner?.status === "fulfilled");

    const retryKey = key();
    const [saved, retried] = await Promise.all([
      booking.submit(input(ids[1]!), retryKey),
      booking.submit(input(ids[1]!), retryKey),
    ]);
    const closedConfig = new Config({
      ...process.env,
      DATABASE_URL: url.href,
      PUBLIC_ORIGIN: config.origin,
      NODE_ENV: "test",
      SERVICE_TIMEZONE: config.timezone,
      BOOKING_NOTICE_MINUTES: "60",
      BOOKING_HORIZON_DAYS: "30",
      INTAKE_WINDOW_MINUTES: "30",
      CONSENT_VERSION: config.consentVersion,
      CONSENT_NOTICE_URL: config.consentNoticeUrl,
      PUBLIC_BOOKING_ENABLED: "false",
    });
    const closedService = new BookingService(db, closedConfig);
    assert.equal((await closedService.options()).enabled, false);
    await rejects(
      closedService.submit(input(ids[2]!), key()),
      "BOOKING_DISABLED",
    );
    assert.deepEqual(
      await closedService.submit(input(ids[1]!), retryKey),
      saved,
      "Disabling new bookings must not block recovery of a committed receipt",
    );
    assert.deepEqual(saved, retried);
    assert.deepEqual(await counts(), {
      appointments: 2,
      events: 2,
      jobs: 4,
      requests: 2,
    });
    await rejects(
      booking.submit({ ...input(ids[1]!), name: "Changed Customer" }, retryKey),
      "IDEMPOTENCY_CONFLICT",
    );
    assert.deepEqual(await counts(), {
      appointments: 2,
      events: 2,
      jobs: 4,
      requests: 2,
    });
    const record = (
      await db.pool.query<{
        phone_original: string;
        phone_normalized: string;
        consent_at: Date;
        telegram_user_id: string | null;
      }>("SELECT * FROM appointments WHERE id = $1", [saved.id])
    ).rows[0]!;
    assert.equal(record.phone_original, "8 (999) 123-45-67");
    assert.equal(record.phone_normalized, "+79991234567");
    assert.ok(record.consent_at instanceof Date);
    assert.equal(record.telegram_user_id, null);
    await rejects(
      booking.submit({ ...input(ids[2]!), phone: "bad" }, key()),
      "INVALID_INPUT",
    );
    await rejects(
      booking.submit({ ...input(ids[2]!), problem: "" }, key()),
      "INVALID_INPUT",
    );
    await rejects(
      booking.submit(
        { ...input(ids[2]!), consent: { accepted: false, version: "test-v1" } },
        key(),
      ),
      "INVALID_INPUT",
    );
    await rejects(
      booking.submit(
        { ...input(ids[2]!), consent: { accepted: true, version: "old" } },
        key(),
      ),
      "CONSENT_CHANGED",
    );

    const initialCount = await counts();
    await rejects(
      booking.reschedule(
        saved.id,
        winner.value.slot.id,
        1,
        operator,
        "Agreed test move",
      ),
      "SLOT_UNAVAILABLE",
    );
    assert.deepEqual(await counts(), initialCount);
    assert.equal(
      (
        await db.pool.query<{ slot_id: string }>(
          "SELECT slot_id FROM appointments WHERE id=$1",
          [saved.id],
        )
      ).rows[0]!.slot_id,
      ids[1],
    );
    const moved = await booking.reschedule(
      saved.id,
      ids[2],
      1,
      operator,
      "Agreed test move",
    );
    assert.equal(moved.slot.id, ids[2]);
    assert.equal(moved.status, "pending");
    assert.equal(moved.revision, 2);
    const afterMove = await counts();
    assert.deepEqual(
      await booking.reschedule(saved.id, ids[3], 1, operator, "Stale move"),
      moved,
    );
    assert.deepEqual(await counts(), afterMove);
    assert.ok(
      (await booking.availability(day(at(0)))).slots.some(
        (slot) => slot.id === ids[1],
      ),
    );
    assert.deepEqual(
      await booking.submit(input(ids[1]!), retryKey),
      saved,
      "Retry returns the original receipt even after a move",
    );

    const confirmed = await booking.changeStatus(saved.id, "confirmed", 2, {
      kind: "owner",
      id: "111",
    });
    assert.equal(confirmed.revision, 3);
    const confirmedCount = await counts();
    assert.deepEqual(
      await booking.changeStatus(saved.id, "confirmed", 2, operator),
      confirmed,
    );
    assert.deepEqual(await counts(), confirmedCount);
    await rejects(
      booking.changeStatus(saved.id, "completed", 3, operator),
      "ARRIVAL_NOT_STARTED",
    );
    await rejects(
      booking.changeStatus(saved.id, "rejected", 3, operator, "Test"),
      "INVALID_TRANSITION",
    );
    await rejects(
      booking.changeStatus(saved.id, "cancelled", 3, operator),
      "INVALID_INPUT",
    );
    await rejects(
      booking.changeStatus(saved.id, "cancelled", 3, {
        kind: "customer",
        id: "555",
      }),
      "FORBIDDEN",
    );
    await db.pool.query(
      "UPDATE appointments SET telegram_user_id='555' WHERE id=$1",
      [saved.id],
    );
    await rejects(
      booking.changeStatus(saved.id, "cancelled", 3, {
        kind: "customer",
        id: "556",
      }),
      "FORBIDDEN",
    );
    const cancelled = await booking.changeStatus(saved.id, "cancelled", 3, {
      kind: "customer",
      id: "555",
    });
    assert.equal(cancelled.status, "cancelled");
    await rejects(
      booking.changeStatus(saved.id, "confirmed", 4, operator),
      "INVALID_TRANSITION",
    );
    assert.ok(
      (await booking.availability(day(at(0)))).slots.some(
        (slot) => slot.id === ids[2],
      ),
    );
    const newBooking = await booking.submit(input(ids[2]!), key(), operator);
    assert.equal(
      (
        await db.pool.query<{ source: string }>(
          "SELECT source FROM appointments WHERE id=$1",
          [newBooking.id],
        )
      ).rows[0]!.source,
      "manual",
    );
    await rejects(
      booking.changeStatus(newBooking.id, "rejected", 1, operator),
      "INVALID_INPUT",
    );
    await booking.changeStatus(
      newBooking.id,
      "rejected",
      1,
      operator,
      "Test rejection",
    );
    await booking.setPublished(ids[2], false, operator);
    assert.ok(
      !(await booking.availability(day(at(0)))).slots.some(
        (slot) => slot.id === ids[2],
      ),
    );
    await rejects(booking.submit(input(ids[2]!), key()), "SLOT_UNAVAILABLE");
    await booking.setPublished(ids[2], true, operator);

    const overlapping = await Promise.allSettled([
      booking.publishWindows(at(10), at(12), operator),
      booking.publishWindows(at(10), at(12), operator),
    ]);
    assert.equal(
      overlapping.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT * FROM intake_slots WHERE start_at >= $1 AND start_at < $2",
          [at(10), at(12)],
        )
      ).rowCount,
      2,
    );
    await rejects(
      booking.publishWindows(
        new Date(tomorrow.getTime() + 15 * 60_000).toISOString(),
        new Date(tomorrow.getTime() + 45 * 60_000).toISOString(),
        operator,
      ),
      "WINDOW_OVERLAP",
    );

    // Failed swaps keep both original reservations, without lock-order deadlocks.
    const other = await booking.submit(input(ids[3]!), key());
    const swaps = await Promise.allSettled([
      booking.reschedule(other.id, ids[0], 1, operator, "Test swap"),
      booking.reschedule(winner.value.id, ids[3], 1, operator, "Test swap"),
    ]);
    assert.ok(swaps.every((result) => result.status === "rejected"));
    await rejects(
      booking.setPublished(ids[0], false, operator),
      "SLOT_OCCUPIED",
    );
    await booking.closeDate(day(at(0)), true, operator);
    assert.equal((await booking.availability(day(at(0)))).slots.length, 0);
    assert.equal(
      (
        await db.pool.query(
          "SELECT * FROM appointments WHERE status IN ('pending','confirmed')",
        )
      ).rowCount,
      2,
    );
    await booking.changeStatus(
      other.id,
      "cancelled",
      1,
      operator,
      "Closed test day",
    );
    assert.equal((await booking.availability(day(at(0)))).slots.length, 0);
    await rejects(
      booking.publishWindows(at(14), at(15), operator),
      "DATE_CLOSED",
    );
    await booking.closeDate(day(at(0)), false, operator);
    assert.equal(
      (await booking.availability(day(at(0)))).slots.length,
      0,
      "Reopening does not automatically publish hidden windows",
    );

    const soon = new Date(Date.now() + 10 * 60_000);
    const nearSlot = (
      await booking.publishWindows(
        soon.toISOString(),
        new Date(soon.getTime() + 30 * 60_000).toISOString(),
        operator,
      )
    )[0]!;
    await rejects(
      booking.submit(input(nearSlot.id), key()),
      "SLOT_UNAVAILABLE",
    );
    assert.ok(
      !(await booking.availability(day(soon.toISOString()))).slots.some(
        (slot) => slot.id === nearSlot.id,
      ),
    );
    const far = new Date(Date.now() + 40 * 24 * 60 * 60_000);
    const farSlot = (
      await booking.publishWindows(
        far.toISOString(),
        new Date(far.getTime() + 30 * 60_000).toISOString(),
        operator,
      )
    )[0]!;
    await rejects(booking.submit(input(farSlot.id), key()), "SLOT_UNAVAILABLE");
    assert.equal(
      (await booking.availability(day(far.toISOString()))).slots.length,
      0,
    );
    await booking.configureService(
      "maintenance",
      "Test disabled",
      false,
      operator,
    );
    await rejects(
      booking.submit(
        { ...input(ids[6]!), serviceKey: "maintenance", problem: "" },
        key(),
      ),
      "INVALID_INPUT",
    );
    const newConsent = new Config({
      ...process.env,
      DATABASE_URL: url.href,
      NODE_ENV: "test",
      PUBLIC_ORIGIN: config.origin,
      SERVICE_TIMEZONE: config.timezone,
      BOOKING_NOTICE_MINUTES: "60",
      BOOKING_HORIZON_DAYS: "30",
      INTAKE_WINDOW_MINUTES: "30",
      CONSENT_VERSION: "test-v2",
      CONSENT_NOTICE_URL: config.consentNoticeUrl,
    });
    assert.deepEqual(
      await new BookingService(db, newConsent).submit(input(ids[1]!), retryKey),
      saved,
    );

    // Force a database event failure: appointment and request must roll back too.
    await booking.setPublished(ids[4], true, operator);
    await db.pool.query(
      "ALTER TABLE notification_jobs ADD CONSTRAINT fail_test_jobs CHECK (false) NOT VALID",
    );
    const beforeFailure = await counts();
    const failedKey = key();
    await assert.rejects(booking.submit(input(ids[4]!), failedKey));
    assert.deepEqual(await counts(), beforeFailure);
    await db.pool.query(
      "ALTER TABLE notification_jobs DROP CONSTRAINT fail_test_jobs",
    );
    const recovered = await booking.submit(input(ids[4]!), failedKey);
    assert.equal(recovered.status, "pending");

    // Past-arrival transitions/cutoff; no production data is changed.
    await db.pool.query(
      "UPDATE intake_slots SET start_at=now()-interval '2 hours', end_at=now()-interval '90 minutes' WHERE id=$1",
      [ids[4]],
    );
    await booking.changeStatus(recovered.id, "confirmed", 1, operator);
    await db.pool.query(
      "UPDATE appointments SET telegram_user_id='555' WHERE id=$1",
      [recovered.id],
    );
    await rejects(
      booking.changeStatus(recovered.id, "cancelled", 2, {
        kind: "customer",
        id: "555",
      }),
      "CANCELLATION_CLOSED",
    );
    assert.equal(
      (await booking.changeStatus(recovered.id, "completed", 2, operator))
        .status,
      "completed",
    );
    assert.equal((await booking.availability(day(at(0)))).slots.length, 0);

    app = await createApplication(config);
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl();
    const post = (
      body: unknown,
      origin: string | undefined = config.origin,
      requestId = key(),
    ) =>
      fetch(`${base}/api/v1/appointments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": requestId,
          ...(origin ? { Origin: origin } : {}),
        },
        body: JSON.stringify(body),
      });
    assert.equal((await fetch(`${base}/api/v1/health`)).status, 200);
    const availabilityResponse = await fetch(
      `${base}/api/v1/slots?date=${day(at(0))}`,
    );
    assert.equal(availabilityResponse.headers.get("cache-control"), "no-store");
    assert.ok(
      !JSON.stringify(await availabilityResponse.json()).includes("phone"),
    );
    assert.equal(
      (await fetch(`${base}/api/v1/slots?date=2026-02-30`)).status,
      400,
    );
    assert.equal(
      (await fetch(`${base}/api/v1/slots?date=0000-01-01`)).status,
      400,
    );
    assert.equal((await post({}, "")).status, 403);
    assert.equal((await post({}, "https://evil.example")).status, 403);
    assert.equal((await post({})).status, 400);
    assert.equal(
      (await post(input(ids[5]!), config.origin, "guessable")).status,
      400,
    );
    assert.equal(
      (
        await fetch(`${base}/api/v1/appointments`, {
          method: "POST",
          headers: { Origin: config.origin, "Content-Type": "text/plain" },
          body: "{}",
        })
      ).status,
      415,
    );
    assert.equal(
      (
        await fetch(`${base}/api/v1/appointments`, {
          method: "POST",
          headers: {
            Origin: config.origin,
            "Content-Type": "application/json",
          },
          body: "{",
        })
      ).status,
      400,
    );
    assert.equal((await post({ padding: "x".repeat(20_000) })).status, 413);
    assert.equal(
      (await fetch(`${base}/api/v1/owner/appointments`)).status,
      404,
    );
    await booking.setPublished(ids[5], true, operator);
    const httpKey = key();
    const receipt = await post(input(ids[5]!), config.origin, httpKey);
    assert.equal(receipt.status, 200);
    const publicReceipt: unknown = await receipt.json();
    assert.deepEqual(
      await (await post(input(ids[5]!), config.origin, httpKey)).json(),
      publicReceipt,
    );
    assert.equal((await post(input(ids[5]!))).status, 409);
    assert.ok(!JSON.stringify(publicReceipt).includes("Test Customer"));

    // Policy edits affect both interfaces without rewriting existing reservations.
    const originalSlot = slots[0]!;
    const beforeSettings = await counts();
    const customer = { kind: "customer", id: "555" } as const;
    const owner = { kind: "owner", id: "111" } as const;
    const initialPolicy = await booking.bookingSettings(owner);
    await rejects(booking.bookingSettings(customer), "FORBIDDEN");
    await rejects(
      booking.updateBookingSettings(
        "windowMinutes",
        45,
        initialPolicy.revision,
        customer,
      ),
      "FORBIDDEN",
    );
    for (const value of [4, 241, 5.5, "30", null]) {
      await rejects(
        booking.updateBookingSettings(
          "windowMinutes",
          value,
          initialPolicy.revision,
          owner,
        ),
        "INVALID_INPUT",
      );
    }
    const changed = await booking.updateBookingSettings(
      "windowMinutes",
      45,
      initialPolicy.revision,
      owner,
    );
    assert.equal(changed.changed, true);
    assert.equal(changed.settings.updatedBy, "111");
    assert.equal(changed.settings.revision, initialPolicy.revision + 1);
    assert.equal(
      (
        await booking.updateBookingSettings(
          "windowMinutes",
          60,
          initialPolicy.revision,
          owner,
        )
      ).changed,
      false,
    );
    assert.equal(
      (
        await booking.updateBookingSettings(
          "windowMinutes",
          45,
          changed.settings.revision,
          owner,
        )
      ).settings.revision,
      changed.settings.revision,
    );
    const newStart = new Date(tomorrow.getTime() + 5 * 86400000).toISOString();
    const newEnd = new Date(
      new Date(newStart).getTime() + 90 * 60000,
    ).toISOString();
    await rejects(
      booking.publishWindows(newStart, newEnd, owner, initialPolicy.revision),
      "SETTINGS_CHANGED",
    );
    const newWindows = await booking.publishWindows(
      newStart,
      newEnd,
      owner,
      changed.settings.revision,
    );
    assert.equal(newWindows.length, 2);
    assert.equal(
      new Date(newWindows[0]!.end).getTime() -
        new Date(newWindows[0]!.start).getTime(),
      45 * 60000,
    );
    assert.equal(
      (await booking.windows(day(originalSlot.start), owner))
        .find((slot) => slot.id === originalSlot.id)!
        .end_at.toISOString(),
      originalSlot.end,
    );
    assert.equal((await booking.availability(day(newStart))).slots.length, 2);
    const restricted = await booking.updateBookingSettings(
      "horizonDays",
      1,
      changed.settings.revision,
      owner,
    );
    assert.equal((await booking.availability(day(newStart))).slots.length, 0);
    await rejects(
      booking.submit(input(newWindows[0]!.id), key()),
      "SLOT_UNAVAILABLE",
    );
    const expanded = await booking.updateBookingSettings(
      "horizonDays",
      30,
      restricted.settings.revision,
      owner,
    );
    const delayed = await booking.updateBookingSettings(
      "noticeMinutes",
      10080,
      expanded.settings.revision,
      owner,
    );
    assert.equal((await booking.availability(day(newStart))).slots.length, 0);
    await rejects(
      booking.submit(input(newWindows[0]!.id), key()),
      "SLOT_UNAVAILABLE",
    );
    const publicOptions = (await (
      await fetch(`${base}/api/v1/booking-options`)
    ).json()) as { noticeMinutes: number; windowMinutes: number };
    assert.equal(publicOptions.noticeMinutes, 10080);
    assert.equal(publicOptions.windowMinutes, 45);
    assert.deepEqual(await counts(), beforeSettings);
    assert.deepEqual(await booking.submit(input(ids[1]!), retryKey), saved);
    await db.migrate();
    assert.deepEqual(await booking.bookingSettings(owner), delayed.settings);

    // A new process/pool keeps policy and replays receipts without duplicates.
    const reopened = new Database(config);
    try {
      assert.deepEqual(
        await new BookingService(reopened, config).bookingSettings(owner),
        delayed.settings,
      );
      assert.deepEqual(
        await new BookingService(reopened, config).submit(
          input(ids[1]!),
          retryKey,
        ),
        saved,
      );
    } finally {
      await reopened.onApplicationShutdown();
    }
  } finally {
    if (app) await app.close();
    await db.onApplicationShutdown();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
