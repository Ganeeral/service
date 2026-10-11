import "reflect-metadata";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { createApplication } from "../app";
import { BookingService } from "../booking.service";
import { Config } from "../config";
import { Database } from "../database";
import { TelegramService } from "../telegram.service";
import { TelegramApi, TelegramError } from "../telegram-api";

const key = () => randomBytes(32).toString("base64url");
const operator = { kind: "operator", id: "local-cli" } as const;

test("Telegram linking, authorization, atomic flows and durable delivery on isolated PostgreSQL", async () => {
  const testUrl = process.env.TEST_DATABASE_URL;
  assert.ok(testUrl, "TEST_DATABASE_URL is required");
  const url = new URL(testUrl);
  assert.match(url.pathname, /_test$/);
  const admin = new Pool({ connectionString: testUrl, max: 1 });
  const schema = `telegram_test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  url.searchParams.set("options", `-c search_path=${schema}`);
  const env = {
    DATABASE_URL: url.href,
    NODE_ENV: "test",
    PUBLIC_BOOKING_ENABLED: "true",
    PUBLIC_ORIGIN: "http://127.0.0.1:3007",
    SERVICE_TIMEZONE: "Europe/Moscow",
    BOOKING_NOTICE_MINUTES: "0",
    BOOKING_HORIZON_DAYS: "30",
    INTAKE_WINDOW_MINUTES: "30",
    CONSENT_VERSION: "test-v1",
    CONSENT_NOTICE_URL: "http://127.0.0.1:3007/test-consent",
    OWNER_TELEGRAM_IDS: "111,222",
    TELEGRAM_ENABLED: "true",
    TELEGRAM_BOT_TOKEN: `123456:${"T".repeat(40)}`,
    TELEGRAM_BOT_USERNAME: "TestServiceBot",
    TELEGRAM_WEBHOOK_SECRET: "S".repeat(40),
    SERVICE_PHONE: "+79990000000",
    SERVICE_ADDRESS: "Test address",
  };
  const config = new Config(env);
  const db = new Database(config);
  let app: Awaited<ReturnType<typeof createApplication>> | undefined;
  const realFetch = globalThis.fetch;
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  let failure:
    | { chat: string; code: number; retry?: number; transport?: boolean }
    | undefined;
  let nextId = 1;
  globalThis.fetch = async (input, init) => {
    const target = String(input);
    if (!target.startsWith("https://api.telegram.org/"))
      return realFetch(input, init);
    const method = target.slice(target.lastIndexOf("/") + 1);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ method, body });
    if (
      method === "sendMessage" &&
      failure &&
      String(body.chat_id) === failure.chat
    ) {
      const current = failure;
      failure = undefined;
      if (current.transport) throw new Error("Synthetic network failure");
      return new Response(
        JSON.stringify({
          ok: false,
          error_code: current.code,
          parameters: current.retry ? { retry_after: current.retry } : {},
        }),
        { status: current.code },
      );
    }
    return new Response(
      JSON.stringify({
        ok: true,
        result: method === "sendMessage" ? { message_id: nextId++ } : true,
      }),
      { status: 200 },
    );
  };
  let counter = 1000;
  let base = "";
  const msg = (user: number, value: string, updateId = ++counter) => ({
    update_id: updateId,
    message: {
      from: { id: user, is_bot: false },
      chat: { id: user, type: "private" },
      text: value,
    },
  });
  const callback = (user: number, data: string, updateId = ++counter) => ({
    update_id: updateId,
    callback_query: {
      id: `q${updateId}`,
      from: { id: user, is_bot: false },
      message: { chat: { id: user, type: "private" } },
      data,
    },
  });
  const webhook = async (value: unknown, secret = config.webhookSecret) =>
    realFetch(`${base}/api/v1/telegram/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": secret,
      },
      body: JSON.stringify(value),
    });
  const deliver = async (value: unknown) => {
    assert.ok((await webhook(value)).ok);
    await app!.get(TelegramService).drain();
  };
  const flow = async (user = "111") =>
    (
      await db.pool.query<{
        payload: { nonce: string; step: string; kind: string };
      }>("SELECT payload FROM telegram_flows WHERE user_id=$1", [user])
    ).rows[0]!.payload;
  const texts = (user: string) =>
    calls
      .filter((c) => c.method === "sendMessage" && c.body.chat_id === user)
      .map((c) => String(c.body.text))
      .join("\n");
  const input = (slotId: string) => ({
    slotId,
    name: "Synthetic Customer",
    phone: "+79990000000",
    make: "Test",
    model: "Car",
    serviceKey: "unknown",
    problem: "<script> synthetic & diagnostics",
    consent: { accepted: true, version: config.consentVersion },
  });
  const future = new Date(Date.now() + 2 * 86400000);
  future.setUTCMinutes(0, 0, 0);
  const at = (n: number) =>
    new Date(future.getTime() + n * 1800000).toISOString();
  try {
    await db.migrate();
    app = await createApplication(config);
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
    const booking = app.get(BookingService);
    const windows = await booking.publishWindows(at(0), at(12), operator);
    await booking.configureService(
      "unknown",
      "Test diagnostics",
      true,
      operator,
    );
    assert.equal((await webhook(msg(333, "/admin"), "wrong")).status, 403);
    assert.equal((await webhook({ update_id: "invalid" })).status, 400);
    assert.equal(
      (await db.pool.query("SELECT * FROM telegram_updates")).rowCount,
      0,
    );
    await deliver({
      update_id: ++counter,
      message: {
        from: { id: 111, is_bot: false },
        chat: { id: -111, type: "group" },
        text: "/admin",
      },
    });
    assert.equal(
      (await db.pool.query("SELECT * FROM telegram_updates")).rowCount,
      0,
    );
    await deliver(msg(333, "/admin"));
    assert.match(texts("333"), /Доступ владельца не предоставлен/);

    const submissionKey = key(),
      data = input(windows[0]!.id);
    const saved = await booking.submit(data, submissionKey);
    assert.ok(saved.telegramLink);
    const token = new URL(saved.telegramLink).searchParams.get("start")!;
    assert.equal(token.length, 43);
    assert.deepEqual(await booking.submit(data, submissionKey), saved);
    assert.deepEqual(
      await new BookingService(
        db,
        new Config({ ...env, TELEGRAM_ENABLED: "false" }),
      ).submit(data, submissionKey),
      saved,
      "Committed link recovery remains stable when bot configuration changes",
    );
    const persisted = (
      await db.pool.query(
        "SELECT result,telegram_link_encrypted FROM submission_requests WHERE appointment_id=$1",
        [saved.id],
      )
    ).rows[0]!;
    assert.ok(!JSON.stringify(persisted).includes(token));
    assert.ok(!JSON.stringify(persisted).includes(saved.telegramLink));
    const tokenRow = (
      await db.pool.query(
        "SELECT token_hash,expires_at FROM appointment_link_tokens WHERE appointment_id=$1",
        [saved.id],
      )
    ).rows[0]!;
    assert.equal(tokenRow.token_hash.length, 64);
    assert.ok(tokenRow.expires_at > new Date());
    const linkedUpdate = msg(333, `/start ${token}`);
    assert.ok((await webhook(linkedUpdate)).ok);
    const pendingPayload = (
      await db.pool.query(
        "SELECT payload FROM telegram_updates WHERE update_id=$1",
        [linkedUpdate.update_id],
      )
    ).rows[0]!;
    assert.ok(
      !JSON.stringify(pendingPayload).includes(token),
      "Inbox stores only the linking hash",
    );
    await app.get(TelegramService).drain();
    assert.equal(
      (await booking.detail(saved.id, { kind: "customer", id: "333" }))
        .telegram_user_id,
      "333",
    );
    assert.match(texts("333"), /Уведомления подключены/);
    assert.match(texts("111"), /&lt;script&gt;/);
    const countBeforeReplay = calls.length;
    await deliver(linkedUpdate);
    assert.equal(
      calls.length,
      countBeforeReplay,
      "Exact update replay sends no extra replies",
    );
    await deliver(msg(444, `/start ${token}`));
    assert.match(texts("444"), /Ссылка недействительна/);
    assert.ok(!texts("444").includes(saved.reference));
    await deliver(callback(444, `cancel:${saved.id}:1`));
    assert.ok(!texts("444").includes(saved.reference));
    assert.equal((await booking.detail(saved.id, operator)).status, "pending");

    // Multi-step owner changes require a nonce bound to the current flow.
    await deliver(callback(111, `confirm:${saved.id}:1`));
    const confirmation = await flow();
    await deliver(callback(111, "ok:0000000000000000"));
    assert.equal((await booking.detail(saved.id, operator)).status, "pending");
    const confirmUpdate = callback(111, `ok:${confirmation.nonce}`);
    await deliver(confirmUpdate);
    await deliver(confirmUpdate);
    assert.equal(
      (await booking.detail(saved.id, operator)).status,
      "confirmed",
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT * FROM appointment_events WHERE appointment_id=$1",
          [saved.id],
        )
      ).rowCount,
      2,
    );
    await deliver(callback(111, `confirm:${saved.id}:1`));
    assert.match(texts("111"), /Карточка устарела/);
    await deliver(callback(111, `note:${saved.id}`));
    await deliver(msg(111, "PRIVATE NOTE"));
    assert.equal(
      (await booking.detail(saved.id, operator)).internal_note,
      "PRIVATE NOTE",
    );
    await deliver(msg(333, "/mine"));
    assert.ok(!texts("333").includes("PRIVATE NOTE"));

    // Expired and late linking disclose only a valid linked appointment's current status.
    const late = await booking.submit(input(windows[1]!.id), key());
    await booking.changeStatus(late.id, "confirmed", 1, operator);
    await deliver(
      msg(
        555,
        `/start ${new URL(late.telegramLink!).searchParams.get("start")}`,
      ),
    );
    assert.match(texts("555"), /Запись подтверждена/);
    assert.ok(!texts("555").includes("Предварительная заявка"));
    const expired = await booking.submit(input(windows[2]!.id), key());
    await db.pool.query(
      "UPDATE appointment_link_tokens SET expires_at=now()-interval '1 second' WHERE appointment_id=$1",
      [expired.id],
    );
    await deliver(
      msg(
        666,
        `/start ${new URL(expired.telegramLink!).searchParams.get("start")}`,
      ),
    );
    assert.ok(!texts("666").includes(expired.reference));

    // Cancellation is confirmed and releases the same queue capacity used by the website.
    await deliver(callback(333, `cancel:${saved.id}:2`));
    const cancellation = await flow("333");
    const cancelUpdate = callback(333, `ok:${cancellation.nonce}`);
    await deliver(cancelUpdate);
    await deliver(cancelUpdate);
    assert.equal(
      (await booking.detail(saved.id, operator)).status,
      "cancelled",
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT * FROM appointment_events WHERE appointment_id=$1",
          [saved.id],
        )
      ).rowCount,
      3,
    );
    const replacement = await booking.submit(input(windows[0]!.id), key());
    assert.equal(replacement.status, "pending");

    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: config.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(future);
    await deliver(callback(111, `move:${late.id}:2`));
    await deliver(msg(111, day));
    const transfer = await flow();
    await deliver(callback(111, `slot:${windows[3]!.id}:${transfer.nonce}`));
    await deliver(msg(111, "Согласовано по телефону"));
    await deliver(callback(111, `ok:${transfer.nonce}`));
    assert.equal(
      (await booking.detail(late.id, operator)).slot_id,
      windows[3]!.id,
    );
    assert.equal((await booking.detail(late.id, operator)).revision, 3);
    // A target reserved after preview leaves the original untouched.
    await deliver(callback(111, `move:${late.id}:3`));
    await deliver(msg(111, day));
    const conflict = await flow();
    await deliver(callback(111, `slot:${windows[4]!.id}:${conflict.nonce}`));
    await deliver(msg(111, "Согласовано"));
    await booking.submit(input(windows[4]!.id), key());
    await deliver(callback(111, `ok:${conflict.nonce}`));
    assert.equal(
      (await booking.detail(late.id, operator)).slot_id,
      windows[3]!.id,
    );
    assert.match(texts("111"), /исходная запись сохранена/);
    await deliver(msg(111, "/cancel"));

    // Owner authorization is rechecked on a persisted multi-step continuation after removal.
    await deliver(callback(111, `reject:${replacement.id}:1`));
    const removedConfig = new Config({ ...env, OWNER_TELEGRAM_IDS: "222" });
    const removed = new TelegramService(
      app.get(Database),
      removedConfig,
      new BookingService(app.get(Database), removedConfig),
      new TelegramApi(removedConfig),
    );
    await app.get(TelegramService).receive(msg(111, "Should not reject"));
    await removed.drain();
    assert.equal(
      (await booking.detail(replacement.id, operator)).status,
      "pending",
    );
    await deliver(msg(111, "/cancel"));

    // Manual wizard uses the shared reservation transaction and explicit owner consent attestation.
    await deliver(msg(111, "/manual"));
    for (const value of [
      "Manual Customer",
      "+79990000001",
      "Test",
      "Manual",
      "unknown",
      "Synthetic diagnostics",
      day,
    ])
      await deliver(msg(111, value));
    const manual = await flow();
    await deliver(callback(111, `slot:${windows[5]!.id}:${manual.nonce}`));
    const manualUpdate = callback(111, `ok:${manual.nonce}`);
    await deliver(manualUpdate);
    await deliver(manualUpdate);
    const manualRow = (
      await db.pool.query("SELECT * FROM appointments WHERE slot_id=$1", [
        windows[5]!.id,
      ])
    ).rows[0]!;
    assert.equal(manualRow.source, "manual");
    assert.equal(manualRow.telegram_user_id, null);
    assert.equal(
      (
        await db.pool.query("SELECT * FROM appointments WHERE slot_id=$1", [
          windows[5]!.id,
        ])
      ).rowCount,
      1,
    );

    // Publication replay and date closure are atomic with deduplication/replies.
    await deliver(msg(111, `/publish ${at(14)} ${at(16)}`));
    const publication = await flow();
    const publishUpdate = callback(111, `ok:${publication.nonce}`);
    // A failure to persist a reply rolls back publication, flow and processed marker together.
    await db.pool.query(
      "ALTER TABLE telegram_messages ADD CONSTRAINT test_reply_failure CHECK (false) NOT VALID",
    );
    assert.ok((await webhook(publishUpdate)).ok);
    await app.get(TelegramService).drain();
    assert.equal(
      (
        await db.pool.query("SELECT * FROM intake_slots WHERE start_at >= $1", [
          at(14),
        ])
      ).rowCount,
      0,
    );
    assert.ok(
      (
        await db.pool.query(
          "SELECT processed_at FROM telegram_updates WHERE update_id=$1",
          [publishUpdate.update_id],
        )
      ).rows[0]!.processed_at === null,
    );
    assert.equal((await flow()).nonce, publication.nonce);
    await db.pool.query(
      "ALTER TABLE telegram_messages DROP CONSTRAINT test_reply_failure",
    );
    await db.pool.query(
      "UPDATE telegram_updates SET available_at=now() WHERE update_id=$1",
      [publishUpdate.update_id],
    );
    await Promise.all([webhook(publishUpdate), webhook(publishUpdate)]);
    await app.get(TelegramService).drain();
    assert.equal(
      (
        await db.pool.query("SELECT * FROM intake_slots WHERE start_at >= $1", [
          at(14),
        ])
      ).rowCount,
      2,
    );
    await deliver(msg(111, `/close ${day}`));
    const closure = await flow();
    await deliver(callback(111, `ok:${closure.nonce}`));
    assert.equal((await booking.availability(day)).slots.length, 0);
    assert.equal((await booking.detail(late.id, operator)).status, "confirmed");
    await deliver(msg(111, `/open ${day}`));
    const opening = await flow();
    await deliver(callback(111, `ok:${opening.nonce}`));
    assert.equal(
      (await booking.availability(day)).slots.length,
      0,
      "Reopening never republishes hidden windows",
    );

    // 429, blocked chats and expired leases do not roll back appointments.
    await db.pool.query("UPDATE intake_slots SET published=true WHERE id=$1", [
      windows[6]!.id,
    ]);
    const retryBooking = await booking.submit(input(windows[6]!.id), key());
    failure = { chat: "111", code: 429, retry: 120 };
    await app.get(TelegramService).drain();
    const retry = (
      await db.pool.query(
        "SELECT m.* FROM telegram_messages m JOIN notification_jobs j ON j.id=m.job_id JOIN appointment_events e ON e.id=j.event_id WHERE e.appointment_id=$1 AND m.chat_id='111'",
        [retryBooking.id],
      )
    ).rows[0]!;
    assert.equal(retry.state, "pending");
    assert.equal(retry.last_error_code, "TELEGRAM_429");
    assert.ok(retry.available_at.getTime() > Date.now() + 100000);
    assert.equal(
      (await booking.detail(retryBooking.id, operator)).status,
      "pending",
    );
    await db.pool.query(
      "UPDATE telegram_messages SET state='processing', claimed_at=now()-interval '1 minute' WHERE id=$1",
      [retry.id],
    );
    await app.close();
    app = await createApplication(config);
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
    await app.get(TelegramService).drain();
    assert.equal(
      (
        await db.pool.query("SELECT state FROM telegram_messages WHERE id=$1", [
          retry.id,
        ])
      ).rows[0]!.state,
      "sent",
    );
    const restartBooking = app.get(BookingService);
    await db.pool.query("UPDATE intake_slots SET published=true WHERE id=$1", [
      windows[7]!.id,
    ]);
    const blocked = await restartBooking.submit(input(windows[7]!.id), key());
    await deliver(
      msg(
        777,
        `/start ${new URL(blocked.telegramLink!).searchParams.get("start")}`,
      ),
    );
    await restartBooking.changeStatus(blocked.id, "confirmed", 1, operator);
    failure = { chat: "777", code: 403 };
    await app.get(TelegramService).drain();
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int AS n FROM telegram_messages WHERE chat_id='777' AND state='failed' AND last_error_code='TELEGRAM_403'",
        )
      ).rows[0]!.n,
      1,
    );
    await deliver(msg(111, "/failures"));
    assert.match(texts("111"), /TELEGRAM_403/);
    assert.equal(
      (await restartBooking.detail(blocked.id, operator)).status,
      "confirmed",
    );
    const failedMessage = (
      await db.pool.query(
        "SELECT id FROM telegram_messages WHERE chat_id='777' AND state='failed'",
      )
    ).rows[0]!.id;
    await restartBooking.changeStatus(
      blocked.id,
      "cancelled",
      2,
      operator,
      "Synthetic cancellation",
    );
    await deliver(callback(111, `retry:${failedMessage}`));
    assert.equal(
      (
        await db.pool.query("SELECT state FROM telegram_messages WHERE id=$1", [
          failedMessage,
        ])
      ).rows[0]!.state,
      "skipped",
      "Retry never sends an obsolete confirmation",
    );
    await deliver(callback(111, `cancel:${retryBooking.id}:1`));
    const expiredFlow = await flow();
    await db.pool.query(
      "UPDATE telegram_flows SET expires_at=now()-interval '1 second' WHERE user_id='111'",
    );
    await deliver(callback(111, `ok:${expiredFlow.nonce}`));
    assert.equal(
      (await restartBooking.detail(retryBooking.id, operator)).status,
      "pending",
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int AS n FROM telegram_updates WHERE processed_at IS NULL",
        )
      ).rows[0]!.n,
      0,
    );
    assert.ok(
      calls.every((c) => c.method !== "setWebhook"),
      "Tests never register a real webhook",
    );
    failure = { chat: "111", code: 429, retry: Number.MAX_SAFE_INTEGER };
    await assert.rejects(
      app.get(TelegramApi).call("sendMessage", {
        chat_id: "111",
        text: "Synthetic bounded retry check",
      }),
      (error) => error instanceof TelegramError && error.retryAfter === 604800,
    );
    // Several valid batches on a short-window day must all remain manageable, not just the first 96.
    const compact = new BookingService(
      db,
      new Config({ ...env, INTAKE_WINDOW_MINUTES: "5" }),
    );
    const policy = await compact.bookingSettings(operator);
    await compact.updateBookingSettings(
      "windowMinutes",
      5,
      policy.revision,
      operator,
    );
    const packedStart = new Date(future.getTime() + 5 * 86400000);
    packedStart.setUTCHours(21, 0, 0, 0);
    for (let index = 0; index < 3; index++) {
      await compact.publishWindows(
        new Date(packedStart.getTime() + index * 8 * 3600000).toISOString(),
        new Date(
          packedStart.getTime() + (index + 1) * 8 * 3600000,
        ).toISOString(),
        operator,
      );
    }
    const packedDay = new Intl.DateTimeFormat("en-CA", {
      timeZone: config.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(packedStart);
    assert.equal((await compact.windows(packedDay, operator)).length, 288);
    await deliver(callback(111, `windowsday:${packedDay}:270`));
    const lastPage = calls.findLast(
      (c) =>
        c.method === "sendMessage" &&
        c.body.chat_id === "111" &&
        String(c.body.text).startsWith(`Окна ${packedDay}`),
    )!;
    assert.equal(
      (lastPage.body.reply_markup as { inline_keyboard: unknown[][] })
        .inline_keyboard.length,
      18,
    );
    // Owner edits are validated, deduplicated and shared with the public API.
    await deliver(callback(777, "setting:windowMinutes"));
    assert.equal(
      (await db.pool.query("SELECT * FROM telegram_flows WHERE user_id='777'"))
        .rowCount,
      0,
    );
    await deliver(msg(111, "/settings"));
    assert.match(texts("111"), /Длительность окна: 5 мин/);
    await deliver(callback(111, "setting:windowMinutes"));
    await deliver(msg(111, "0"));
    assert.equal((await flow()).step, "value");
    await deliver(msg(111, "45"));
    const settingsFlow = await flow();
    const confirmSettings = callback(111, `ok:${settingsFlow.nonce}`);
    await Promise.all([webhook(confirmSettings), webhook(confirmSettings)]);
    await app.get(TelegramService).drain();
    const savedPolicy = await restartBooking.bookingSettings(operator);
    assert.equal(savedPolicy.windowMinutes, 45);
    assert.equal(savedPolicy.revision, policy.revision + 2);
    const options = (await (
      await realFetch(`${base}/api/v1/booking-options`)
    ).json()) as { windowMinutes: number };
    assert.equal(options.windowMinutes, 45);
    await deliver(callback(111, "setting:noticeMinutes"));
    await deliver(msg(111, "150"));
    const staleSetting = await flow();
    await deliver(callback(222, "setting:horizonDays"));
    await deliver(msg(222, "10"));
    const secondOwner = await flow("222");
    await deliver(callback(222, `ok:${secondOwner.nonce}`));
    await deliver(callback(111, `ok:${staleSetting.nonce}`));
    assert.equal(
      (await restartBooking.bookingSettings(operator)).noticeMinutes,
      0,
    );
    assert.equal(
      (await restartBooking.bookingSettings(operator)).horizonDays,
      10,
    );
    await deliver(callback(111, "windows"));
    await deliver(msg(111, packedDay));
    assert.equal(
      (await db.pool.query("SELECT * FROM telegram_flows WHERE user_id='111'"))
        .rowCount,
      0,
    );
    const laterStart = new Date(future.getTime() + 9 * 86400000).toISOString();
    const laterEnd = new Date(
      new Date(laterStart).getTime() + 90 * 60000,
    ).toISOString();
    await deliver(msg(111, `/publish ${laterStart} ${laterEnd}`));
    const stalePublication = await flow();
    const beforePublication = (
      await db.pool.query("SELECT count(*)::int AS n FROM intake_slots")
    ).rows[0]!.n;
    await deliver(callback(222, "setting:windowMinutes"));
    await deliver(msg(222, "30"));
    const newDuration = await flow("222");
    await deliver(callback(222, `ok:${newDuration.nonce}`));
    await deliver(callback(111, `ok:${stalePublication.nonce}`));
    assert.equal(
      (await db.pool.query("SELECT count(*)::int AS n FROM intake_slots"))
        .rows[0]!.n,
      beforePublication,
    );
    assert.match(texts("111"), /Настройки записи изменились/);
    const persistedPolicy = await restartBooking.bookingSettings(operator);
    await app.close();
    app = await createApplication(config);
    assert.deepEqual(
      await app.get(BookingService).bookingSettings(operator),
      persistedPolicy,
    );
  } finally {
    globalThis.fetch = realFetch;
    if (app) await app.close();
    await db.onApplicationShutdown();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
