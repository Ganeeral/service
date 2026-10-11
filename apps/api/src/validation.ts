import { BadRequestException } from "@nestjs/common";

export function invalid(field: string): never {
  throw new BadRequestException({ code: "INVALID_INPUT", field });
}

export function object(
  input: unknown,
  allowed: readonly string[],
): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    invalid("body");
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalid("body");
  return value;
}

export function text(
  input: unknown,
  field: string,
  min: number,
  max: number,
): string {
  if (typeof input !== "string") invalid(field);
  const value = input.trim();
  if (
    value.length < min ||
    value.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
  )
    invalid(field);
  return value;
}

export function uuid(input: unknown, field: string): string {
  const value = text(input, field, 36, 36).toLowerCase();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      value,
    )
  )
    invalid(field);
  return value;
}

export function localDate(input: unknown): string {
  const value = text(input, "date", 10, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value.startsWith("0000-") ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    invalid("date");
  return value;
}

export function instant(input: unknown, field: string): Date {
  const value = text(input, field, 20, 35);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  )
    invalid(field);
  localDate(value.slice(0, 10));
  return new Date(value);
}

function optionalInteger(
  input: unknown,
  field: string,
  min: number,
  max: number,
): number | null {
  if (input === undefined || input === null) return null;
  if (
    typeof input !== "number" ||
    !Number.isSafeInteger(input) ||
    input < min ||
    input > max
  )
    invalid(field);
  return input;
}

export function bookingInput(input: unknown, timezone: string) {
  const value = object(input, [
    "slotId",
    "name",
    "phone",
    "telegramUsername",
    "make",
    "model",
    "year",
    "mileage",
    "serviceKey",
    "problem",
    "consent",
  ]);
  const phoneOriginal = text(value.phone, "phone", 10, 40);
  if (!/^\+?[\d\s()\-]+$/.test(phoneOriginal)) invalid("phone");
  let digits = phoneOriginal.replace(/\D/g, "");
  if (digits.length === 10) digits = `7${digits}`;
  if (digits.length === 11 && digits.startsWith("8"))
    digits = `7${digits.slice(1)}`;
  // ponytail: +7 only, add country-aware validation when accepted countries are approved.
  if (!/^7[3489]\d{9}$/.test(digits)) invalid("phone");
  const serviceKey = text(value.serviceKey, "serviceKey", 1, 60);
  if (!/^[a-z][a-z0-9_-]*$/.test(serviceKey)) invalid("serviceKey");
  const problem = text(
    value.problem ?? "",
    "problem",
    serviceKey === "unknown" ? 1 : 0,
    2000,
  );
  const telegram = text(
    value.telegramUsername ?? "",
    "telegramUsername",
    0,
    33,
  ).replace(/^@/, "");
  if (telegram && !/^[a-zA-Z0-9_]{1,32}$/.test(telegram))
    invalid("telegramUsername");
  const consent = object(value.consent, ["accepted", "version"]);
  if (consent.accepted !== true) invalid("consent");
  const year = Number(
    new Intl.DateTimeFormat("en", {
      year: "numeric",
      timeZone: timezone,
    }).format(),
  );
  return {
    slotId: uuid(value.slotId, "slotId"),
    name: text(value.name, "name", 2, 80),
    phoneOriginal,
    phoneNormalized: `+${digits}`,
    telegramUsername: telegram ? `@${telegram}` : null,
    make: text(value.make, "make", 1, 60),
    model: text(value.model, "model", 1, 80),
    year: optionalInteger(value.year, "year", 1900, year + 1),
    mileage: optionalInteger(value.mileage, "mileage", 0, 5_000_000),
    serviceKey,
    problem,
    consentVersion: text(consent.version, "consent.version", 1, 100),
  };
}

export function requestKey(input: unknown): string {
  if (
    typeof input !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(input) ||
    Buffer.from(input, "base64url").toString("base64url") !== input
  )
    invalid("Idempotency-Key");
  return input;
}
