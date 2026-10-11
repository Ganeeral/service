import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { serviceOptions } = await import("../apps/web/src/lib/site-content.ts");
const testDate = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
const fixtureSlots = ["10:00", "11:30", "14:00", "15:30"].map(
  (time, index) => ({
    id: `00000000-0000-4000-8000-00000000000${index}`,
    start: `${testDate}T${String(Number(time.slice(0, 2)) - 3).padStart(2, "0")}:${time.slice(3)}:00Z`,
    end: new Date(
      Date.parse(
        `${testDate}T${String(Number(time.slice(0, 2)) - 3).padStart(2, "0")}:${time.slice(3)}:00Z`,
      ) + 1800000,
    ).toISOString(),
  }),
);
const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch({ headless: true });
const screenshots =
  process.env.SCREENSHOT_DIR ?? join(tmpdir(), "service-ilyxa-smoke");
await mkdir(screenshots, { recursive: true });

try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await page.route("**/api/v1/booking-options", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        timezone: "Europe/Moscow",
        noticeMinutes: 60,
        horizonDays: 30,
        windowMinutes: 30,
        services: serviceOptions.map((item) => ({
          key: item.id,
          title: item.title,
        })),
        consent: {
          version: "test-only",
          noticeUrl: new URL(
            "/booking-test-notice",
            process.env.BASE_URL ?? "http://127.0.0.1:3007",
          ).href,
        },
      },
    }),
  );
  await page.route("**/api/v1/slots?*", (route) =>
    route.fulfill({
      json: {
        date: new URL(route.request().url()).searchParams.get("date"),
        timezone: "Europe/Moscow",
        slots: fixtureSlots,
      },
    }),
  );
  const errors = [];
  const writes = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method()))
      writes.push(request.url());
  });
  await page.goto(process.env.BASE_URL ?? "http://127.0.0.1:3007", {
    waitUntil: "networkidle",
  });
  const serviceField = page.getByRole("combobox", {
    name: /Что нужно сделать/,
  });
  const serviceSelect = page.locator('select[name="service"]');
  await serviceField.waitFor();
  await page.waitForFunction(
    () => !document.querySelector('button[role="combobox"]')?.disabled,
  );
  assert.equal(
    await serviceSelect.evaluate((select) => select.checkValidity()),
    false,
  );
  assert.equal(await serviceField.getAttribute("aria-invalid"), "true");
  assert.equal(
    await serviceField.evaluate(
      (element) => element === document.activeElement,
    ),
    true,
  );
  await page
    .getByRole("alert")
    .filter({ hasText: "Выберите доступную услугу." })
    .waitFor();
  assert.equal(
    await page.evaluate(() =>
      [...document.querySelectorAll("body *")].some(
        (element) => getComputedStyle(element).textTransform === "uppercase",
      ),
    ),
    false,
    "No forced uppercase text",
  );
  for (const width of [1440, 768, 390, 360]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => document.fonts.ready);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `Horizontal overflow at ${width}px`,
    );
    await page.screenshot({
      path: join(screenshots, `landing-${width}.png`),
      fullPage: true,
    });
    await serviceField.click();
    const list = page.getByRole("listbox", { name: /Что нужно сделать/ });
    await list.waitFor();
    assert.equal(await list.getByRole("option").count(), 7);
    await page.waitForFunction(() => {
      const combo = document.querySelector('button[role="combobox"]');
      return (
        document.getElementById(combo.getAttribute("aria-controls"))
          .parentElement.style.height === "auto"
      );
    });
    const bounds = await list.boundingBox();
    assert.ok(
      bounds.x >= 0 &&
        bounds.x + bounds.width <= width &&
        bounds.y >= 0 &&
        bounds.y + bounds.height <= 1000,
      `Service list fits ${width}px viewport`,
    );
    await page.screenshot({ path: join(screenshots, `dropdown-${width}.png`) });
    await serviceField.press("Escape");
    assert.equal(await serviceField.getAttribute("aria-expanded"), "false");
    assert.equal(await serviceSelect.inputValue(), "");
  }

  await page.getByRole("button", { name: "Открыть меню" }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "Закрыть меню" })
      .getAttribute("aria-expanded"),
    "true",
  );
  await page.keyboard.press("Escape");
  assert.equal(
    await page
      .getByRole("button", { name: "Открыть меню" })
      .getAttribute("aria-expanded"),
    "false",
  );
  await page.getByRole("button", { name: "Открыть меню" }).click();
  await page
    .getByRole("navigation", { name: "Мобильная навигация" })
    .getByRole("link", { name: "Услуги" })
    .click();
  assert.equal(
    await page
      .getByRole("button", { name: "Открыть меню" })
      .getAttribute("aria-expanded"),
    "false",
  );

  await page
    .getByRole("link", {
      name: "Диагностика — перейти к форме записи",
      exact: true,
    })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector('select[name="service"]')?.value === "diagnostics",
  );
  assert.match(await serviceField.innerText(), /Диагностика/);
  await serviceField.press("End");
  await serviceField.press("Escape");
  assert.equal(
    await serviceSelect.inputValue(),
    "diagnostics",
    "Escape cancels keyboard exploration",
  );
  await serviceField.press("Home");
  await serviceField.press("ArrowDown");
  await serviceField.press("Space");
  await page.waitForFunction(
    () =>
      document.querySelector('select[name="service"]').value === "maintenance",
  );
  // Playwright's physical key map does not include Cyrillic keys.
  await serviceField.dispatchEvent("keydown", { key: "р", code: "KeyH" });
  await serviceField.dispatchEvent("keydown", { key: "е", code: "KeyT" });
  await serviceField.press("Enter");
  await page.waitForFunction(
    () => document.querySelector('select[name="service"]').value === "engine",
  );
  await serviceField.click();
  await page
    .getByRole("heading", { name: "Запись в сервис", exact: true })
    .click();
  assert.equal(
    await serviceField.getAttribute("aria-expanded"),
    "false",
    "Click outside closes the menu",
  );
  await serviceField.press("Home");
  await serviceField.press("Tab");
  await page.waitForFunction(
    () =>
      document.querySelector('select[name="service"]').value === "diagnostics",
  );
  assert.equal(
    await page
      .locator('[name="problem"]')
      .evaluate((input) => input === document.activeElement),
    true,
    "Tab commits the option and advances focus",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await serviceField.click();
  await page.waitForFunction(() => {
    const combo = document.querySelector('button[role="combobox"]');
    return (
      document.getElementById(combo.getAttribute("aria-controls")).parentElement
        .style.height === "auto"
    );
  });
  await serviceField.press("Escape");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.locator('[name="make"]').fill("Volkswagen");
  await page.locator('[name="model"]').fill("Golf");
  await page.locator('[name="name"]').fill("Тестовый клиент");
  const phone = page.locator('[name="phone"]');
  await phone.fill("89000000000");
  assert.equal(await phone.inputValue(), "+7 (900) 000-00-00");
  await phone.fill("");
  await phone.pressSequentially("9001234567");
  assert.equal(await phone.inputValue(), "+7 (900) 123-45-67");
  await phone.press("Backspace");
  assert.equal(await phone.inputValue(), "+7 (900) 123-45-6");
  assert.equal(await phone.evaluate((input) => input.checkValidity()), false);
  await phone.press("7");
  await phone.evaluate((input) => input.setSelectionRange(8, 8));
  await phone.press("Backspace");
  assert.equal(
    await phone.inputValue(),
    "+7 (901) 234-56-7",
    "Backspace skips mask punctuation",
  );
  await phone.fill("+7 (900) 123-45-67");
  await phone.evaluate((input) => input.setSelectionRange(7, 7));
  await phone.press("Delete");
  assert.equal(
    await phone.inputValue(),
    "+7 (900) 234-56-7",
    "Delete skips mask punctuation",
  );
  await phone.fill("+7 (900) 123-45-67");
  await phone.evaluate((input) => input.setSelectionRange(9, 10));
  await phone.press("9");
  assert.equal(
    await phone.inputValue(),
    "+7 (900) 923-45-67",
    "Mid-number edit retains the remaining digits",
  );
  assert.equal(await phone.evaluate((input) => input.selectionStart), 10);
  await phone.fill("");
  assert.equal(await phone.inputValue(), "");
  await phone.fill("+7 900 000 00 00");
  await phone.fill("8001234567");
  assert.equal(
    await phone.inputValue(),
    "+7 (800) 123-45-67",
    "Ten-digit local paste must not drop the first digit",
  );
  await phone.fill("+7 900 000 00 00");
  const telegram = page.locator('[name="telegram"]');
  assert.equal(await telegram.evaluate((input) => input.required), false);
  assert.equal(await telegram.evaluate((input) => input.checkValidity()), true);
  await telegram.fill("test_client");
  await telegram.blur();
  assert.equal(await telegram.inputValue(), "@test_client");
  await telegram.fill("@bad username");
  assert.equal(
    await telegram.evaluate((input) => input.checkValidity()),
    false,
  );
  await telegram.fill("@test_client");
  await page.locator('[name="date"]').fill(testDate);
  await page
    .locator('[name="time"][value="00000000-0000-4000-8000-000000000000"]')
    .check({ force: true });
  await page.locator('[name="consent"]').check();
  await serviceField.click();
  await page
    .getByRole("option", { name: "Не знаю / нужна диагностика", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelector('[name="problem"]')?.required,
  );
  assert.equal(
    await page.locator("form").evaluate((form) => form.checkValidity()),
    false,
    "Unknown task needs a problem description",
  );
  await page.locator('[name="problem"]').fill("Стук спереди при повороте");
  await page.getByRole("button", { name: "Проверить заявку" }).click();
  await page.getByRole("region", { name: "Проверьте заявку" }).waitFor();
  assert.match(
    await page.getByRole("region", { name: "Проверьте заявку" }).innerText(),
    /предварительную заявку/,
  );
  assert.match(
    await page.getByRole("region", { name: "Проверьте заявку" }).innerText(),
    /@test_client/,
  );
  assert.equal(
    await page.getByRole("button", { name: "Отправить заявку" }).isEnabled(),
    true,
  );

  await page
    .getByRole("link", {
      name: "Тормозная система — перейти к форме записи",
      exact: true,
    })
    .click();
  await page.waitForFunction(
    () => document.querySelector('select[name="service"]')?.value === "brakes",
  );
  assert.equal(
    await page.locator('[name="make"]').inputValue(),
    "Volkswagen",
    "Changing service must retain vehicle input",
  );
  assert.equal(
    await page.locator('[name="problem"]').inputValue(),
    "Стук спереди при повороте",
  );
  assert.equal(
    await page.getByRole("region", { name: "Проверьте заявку" }).count(),
    0,
    "Old preview must not survive a service change",
  );
  assert.equal(
    await page.locator('[name="problem"]').evaluate((input) => input.required),
    false,
  );
  const question = page.getByRole("button", {
    name: "Сколько времени займёт ремонт?",
  });
  await question.click();
  assert.equal(await question.getAttribute("aria-expanded"), "true");
  const answer = page.getByRole("region", {
    name: "Сколько времени займёт ремонт?",
  });
  await answer.waitFor();
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll("#faq button")].find((item) =>
      item.textContent.includes("Сколько времени"),
    );
    const panel = document.getElementById(button.getAttribute("aria-controls"));
    return panel.style.height === "auto";
  });
  await question.focus();
  await page.keyboard.press("Enter");
  assert.equal(await question.getAttribute("aria-expanded"), "false");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await question.press("Space");
  assert.equal(await question.getAttribute("aria-expanded"), "true");
  await page.getByRole("button", { name: "Как узнать стоимость?" }).click();
  assert.equal(await question.getAttribute("aria-expanded"), "false");
  assert.equal(
    await page.locator('#faq button[aria-expanded="true"]').count(),
    1,
  );
  await page.waitForFunction(() => {
    const open = document.querySelector('#faq button[aria-expanded="true"]');
    return (
      document.getElementById(open.getAttribute("aria-controls")).style
        .height === "auto"
    );
  });
  assert.equal(
    await answer.count(),
    0,
    "Closed answer is hidden from accessibility tree",
  );
  assert.equal(
    await page
      .locator('[aria-hidden="true"][role="region"]')
      .first()
      .evaluate((panel) => panel.inert),
    true,
  );
  assert.deepEqual(
    writes,
    [],
    "Review must not send appointment/customer data before confirmation",
  );
  assert.deepEqual(errors, [], "No browser runtime errors");
  console.log(
    `PASS: four responsive widths, mobile menu, animated service dropdown/keyboard/typeahead/validation, service preselection, phone mask, optional Telegram, review before sending, draft preservation, FAQ/reduced motion, no write requests. Screenshots: ${screenshots}`,
  );
} finally {
  await browser.close();
}
