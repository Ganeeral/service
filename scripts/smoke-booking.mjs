import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
require("reflect-metadata");
const { chromium } = require("playwright");
const { Pool } = require("pg");
const { Config } = require("../apps/api/dist/config.js");
const { Database } = require("../apps/api/dist/database.js");
const { BookingService } = require("../apps/api/dist/booking.service.js");
const { createApplication } = require("../apps/api/dist/app.js");
const { serviceOptions } = await import("../apps/web/src/lib/site-content.ts");
const base = process.env.BASE_URL ?? "http://127.0.0.1:3007";
assert.ok(process.env.TEST_DATABASE_URL, "Set TEST_DATABASE_URL explicitly");
const databaseUrl = new URL(process.env.TEST_DATABASE_URL);
assert.match(databaseUrl.pathname, /_test$/);
const admin = new Pool({ connectionString: databaseUrl.href, max: 1 });
const schema = `booking_ui_test_${randomUUID().replaceAll("-", "")}`;
await admin.query(`CREATE SCHEMA ${schema}`);
databaseUrl.searchParams.set("options", `-c search_path=${schema}`);
const config = new Config({
  DATABASE_URL: databaseUrl.href,
  NODE_ENV: "test",
  PUBLIC_ORIGIN: new URL(base).origin,
  PUBLIC_BOOKING_ENABLED: "true",
  SERVICE_TIMEZONE: "Europe/Moscow",
  BOOKING_NOTICE_MINUTES: "60",
  BOOKING_HORIZON_DAYS: "30",
  INTAKE_WINDOW_MINUTES: "30",
  CONSENT_VERSION: "test-ui-only",
  CONSENT_NOTICE_URL: new URL("/booking-test-notice", base).href,
  TELEGRAM_ENABLED: "true",
  TELEGRAM_BOT_TOKEN: `123456:${"T".repeat(40)}`,
  TELEGRAM_BOT_USERNAME: "TestServiceBot",
  TELEGRAM_WEBHOOK_SECRET: "S".repeat(40),
  OWNER_TELEGRAM_IDS: "111",
});
const db = new Database(config);
const booking = new BookingService(db, config);
const operator = { kind: "operator", id: "local-cli" };
let app;
let browser;
const screenshots = join(tmpdir(), "service-ilyxa-booking-smoke");
await mkdir(screenshots, { recursive: true });
try {
  await db.migrate();
  for (const item of serviceOptions)
    await booking.configureService(item.id, item.title, true, operator);
  const start = new Date(Date.now() + 2 * 86400000);
  start.setUTCHours(7, 0, 0, 0);
  const date = start.toISOString().slice(0, 10);
  const slots = await booking.publishWindows(
    start.toISOString(),
    new Date(start.getTime() + 6 * 1800000).toISOString(),
    operator,
  );
  app = await createApplication(config);
  await app.listen(0, "127.0.0.1");
  const api = await app.getUrl();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  const requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let failOptions = false;
  let failSlots = false;
  let loseReceipt = false;
  let rejectField = false;
  let changeConsent = false;
  let closed = false;
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("booking-options")) {
      if (failOptions)
        return route.fulfill({ status: 503, json: { code: "INTERNAL_ERROR" } });
      if (closed)
        return route.fulfill({
          json: { ...(await booking.options()), enabled: false },
        });
    }
    if (url.pathname.endsWith("slots") && failSlots)
      return route.fulfill({ status: 503, json: { code: "INTERNAL_ERROR" } });
    if (request.method() === "POST") {
      requests.push({
        key: request.headers()["idempotency-key"],
        body: request.postDataJSON(),
      });
      if (rejectField) {
        rejectField = false;
        return route.fulfill({
          status: 400,
          json: { code: "INVALID_INPUT", field: "name" },
        });
      }
      if (changeConsent) {
        changeConsent = false;
        return route.fulfill({
          status: 409,
          json: { code: "CONSENT_CHANGED" },
        });
      }
    }
    const response = await route.fetch({
      url: `${api}${url.pathname}${url.search}`,
    });
    if (request.method() === "POST" && loseReceipt) {
      loseReceipt = false;
      return route.abort("failed");
    }
    await route.fulfill({ response });
  });
  const ready = async () => {
    await page.waitForFunction(
      () => !document.querySelector('[role="combobox"]')?.disabled,
    );
  };
  const fill = async (index) => {
    await page.goto(`${base}/?service=unknown#booking`);
    await page.reload();
    await ready();
    await page.locator('[name="make"]').fill("Test Make");
    await page.locator('[name="model"]').fill("Test Vehicle");
    await page
      .locator('[name="problem"]')
      .fill("Controlled UI test, not a customer");
    await page.locator('[name="name"]').fill("Test Customer");
    await page.locator('[name="phone"]').fill("+7 999 123 45 67");
    await page.locator('[name="telegram"]').fill("test_contact");
    await page.locator('[name="date"]').fill(date);
    await page
      .locator(`[name="time"][value="${slots[index].id}"]`)
      .check({ force: true });
  };
  const review = async () => {
    await page.locator('[name="consent"]').check();
    await page
      .getByRole("button", { name: "Проверить заявку", exact: true })
      .click();
    await page.getByRole("region", { name: "Проверьте заявку" }).waitFor();
  };
  const count = async () =>
    Number(
      (await db.pool.query("SELECT count(*) AS count FROM appointments"))
        .rows[0].count,
    );

  failOptions = true;
  await page.goto(base);
  await page.getByText("Не удалось подключиться к записи.").waitFor();
  await page.locator('[name="make"]').fill("Preserved Make");
  failOptions = false;
  await page
    .getByRole("button", { name: "Повторить загрузку", exact: true })
    .click();
  await ready();
  assert.equal(
    await page.locator('[name="make"]').inputValue(),
    "Preserved Make",
  );
  failSlots = true;
  await page.locator('[name="date"]').fill(date);
  await page.getByText("Не удалось загрузить расписание.").waitFor();
  failSlots = false;
  await page.getByRole("button", { name: "Повторить загрузку окон" }).click();
  await page.locator('[name="time"]').first().waitFor({ state: "attached" });
  const emptyDate = new Date(start.getTime() + 86400000)
    .toISOString()
    .slice(0, 10);
  await page.locator('[name="date"]').fill(emptyDate);
  await page.getByText("На эту дату свободных окон нет.").waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Проверить заявку", exact: true })
      .isDisabled(),
    true,
  );

  await fill(0);
  assert.equal(await page.locator('[name="consent"]').isChecked(), false);
  await page
    .getByRole("button", { name: "Проверить заявку", exact: true })
    .click();
  assert.equal(
    await page.getByRole("region", { name: "Проверьте заявку" }).count(),
    0,
  );
  assert.equal(await count(), 0);
  await review();
  assert.equal(await count(), 0, "Review is not persistence");
  const beforeRequests = requests.length;
  loseReceipt = true;
  await page
    .getByRole("button", { name: "Отправить заявку", exact: true })
    .dblclick();
  await page.getByRole("status", { name: "Проверка отправки" }).waitFor();
  assert.equal(
    await count(),
    1,
    "The lost HTTP receipt followed a committed appointment",
  );
  assert.equal(
    requests.length,
    beforeRequests + 1,
    "Duplicate clicks issue one request",
  );
  assert.equal(await page.locator('[name="phone"]').isDisabled(), true);
  await page.getByRole("button", { name: "Проверить заявку ещё раз" }).click();
  const success = page.getByRole("status", { name: "Заявка сохранена" });
  await success.waitFor();
  assert.match(await success.innerText(), /предварительная запись/);
  const botLink = success.getByRole("link", {
    name: "Получать уведомления в Telegram",
  });
  assert.match(
    await botLink.getAttribute("href"),
    /^https:\/\/t\.me\/TestServiceBot\?start=[A-Za-z0-9_-]{43}$/,
  );
  assert.equal(await botLink.getAttribute("rel"), "noreferrer");
  assert.match(await success.innerText(), /нажмите Start/);
  assert.deepEqual(
    requests.at(-1),
    requests.at(-2),
    "Network recovery preserves both body and capability",
  );
  assert.equal(await count(), 1);
  assert.equal(
    (await db.pool.query("SELECT * FROM notification_jobs")).rowCount,
    2,
  );
  assert.equal(
    (await db.pool.query("SELECT * FROM appointment_events")).rowCount,
    1,
  );
  await page.locator("form").screenshot({
    path: join(screenshots, "saved-desktop.png"),
    style: "header { visibility: hidden; }",
  });

  // Another customer wins the slot after the browser's availability snapshot.
  await fill(1);
  await review();
  await booking.submit(
    {
      slotId: slots[1].id,
      name: "Competing Test",
      phone: "+79990000000",
      make: "Test",
      model: "Race",
      serviceKey: "unknown",
      problem: "Race test",
      consent: { accepted: true, version: config.consentVersion },
    },
    randomBytes(32).toString("base64url"),
  );
  await page
    .getByRole("button", { name: "Отправить заявку", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Это окно уже заняли" })
    .waitFor();
  assert.equal(await page.locator('[name="make"]').inputValue(), "Test Make");
  assert.equal(
    await page.locator(`[name="time"][value="${slots[1].id}"]`).count(),
    0,
  );
  const conflictKey = requests.at(-1).key;
  await page
    .locator(`[name="time"][value="${slots[2].id}"]`)
    .check({ force: true });
  await review();
  await page
    .getByRole("button", { name: "Отправить заявку", exact: true })
    .click();
  await success.waitFor();
  assert.notEqual(requests.at(-1).key, conflictKey);
  assert.equal(await count(), 3);

  await fill(3);
  await review();
  rejectField = true;
  await page
    .getByRole("button", { name: "Отправить заявку", exact: true })
    .click();
  await page.waitForFunction(
    () => document.activeElement?.getAttribute("name") === "name",
  );
  assert.equal(
    await page.locator('[name="name"]').getAttribute("aria-invalid"),
    "true",
  );
  assert.equal(
    await page.locator('[name="phone"]').inputValue(),
    "+7 (999) 123-45-67",
  );
  await page.locator('[name="name"]').fill("Corrected Test Customer");
  await review();
  changeConsent = true;
  await page
    .getByRole("button", { name: "Отправить заявку", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Условия обработки данных обновились" })
    .waitFor();
  await ready();
  assert.equal(await page.locator('[name="consent"]').isChecked(), false);
  assert.equal(await count(), 3);

  await page.setViewportSize({ width: 390, height: 844 });
  await fill(3);
  await review();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page
    .getByRole("button", { name: "Отправить заявку", exact: true })
    .click();
  await success.waitFor();
  assert.equal(await count(), 4);
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.locator("form").screenshot({
    path: join(screenshots, "saved-mobile.png"),
    style: "header { visibility: hidden; }",
  });
  closed = true;
  await page.goto(base);
  await page.getByText("Онлайн-запись пока закрыта.").waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Проверить заявку", exact: true })
      .isDisabled(),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    `PASS: real form-to-Nest-to-PostgreSQL persistence, lost receipt recovery, duplicate clicks, slot conflict, validation focus, consent reset, availability errors/empty, disabled booking, mobile success. Screenshots: ${screenshots}`,
  );
} finally {
  if (browser) await browser.close();
  if (app) await app.close();
  await db.onApplicationShutdown();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
}
