export type Slot = { id: string; start: string; end: string };
export type BookingOptions = {
  enabled: boolean;
  timezone: string;
  noticeMinutes: number;
  horizonDays: number;
  windowMinutes: number;
  services: { key: string; title: string }[];
  consent: { version: string; noticeUrl: string };
};
export type BookingInput = {
  slotId: string;
  name: string;
  phone: string;
  telegramUsername: string;
  make: string;
  model: string;
  serviceKey: string;
  problem: string;
  consent: { accepted: true; version: string };
};
export type Receipt = {
  id: string;
  reference: string;
  status: "pending";
  revision: number;
  slot: Slot;
  timezone: string;
  telegramLink?: string;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly field?: string,
  ) {
    super(code);
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid API response");
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== "string" || !value)
    throw new Error("Invalid API string");
  return value;
}
function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid API number");
  return value;
}
function timezone(value: unknown): string {
  const zone = string(value);
  new Intl.DateTimeFormat("ru", { timeZone: zone }).format();
  return zone;
}
function slot(value: unknown): Slot {
  const data = record(value);
  const result = {
    id: string(data.id),
    start: string(data.start),
    end: string(data.end),
  };
  if (
    !/^[\da-f-]{36}$/i.test(result.id) ||
    !Number.isFinite(Date.parse(result.start)) ||
    !Number.isFinite(Date.parse(result.end)) ||
    Date.parse(result.end) <= Date.parse(result.start)
  )
    throw new Error("Invalid API slot");
  return result;
}

async function json(path: string, init: RequestInit = {}): Promise<unknown> {
  const signal = init.signal
    ? AbortSignal.any([init.signal, AbortSignal.timeout(12_000)])
    : AbortSignal.timeout(12_000);
  const response = await fetch(`/api/v1/${path}`, {
    ...init,
    signal,
    cache: "no-store",
    credentials: "same-origin",
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const detail = record(body);
    throw new ApiError(
      response.status,
      typeof detail.code === "string" ? detail.code : "HTTP_ERROR",
      typeof detail.field === "string" ? detail.field : undefined,
    );
  }
  return body;
}

export async function loadOptions(
  signal: AbortSignal,
): Promise<BookingOptions> {
  const data = record(await json("booking-options", { signal }));
  if (typeof data.enabled !== "boolean" || !Array.isArray(data.services))
    throw new Error("Invalid booking options");
  const consent = record(data.consent);
  const noticeUrl = new URL(string(consent.noticeUrl));
  if (
    noticeUrl.origin !== window.location.origin ||
    noticeUrl.username ||
    noticeUrl.password
  )
    throw new Error("Invalid notice URL");
  return {
    enabled: data.enabled,
    timezone: timezone(data.timezone),
    noticeMinutes: integer(data.noticeMinutes),
    horizonDays: integer(data.horizonDays),
    windowMinutes: integer(data.windowMinutes),
    services: data.services.map((value: unknown) => {
      const service = record(value);
      return { key: string(service.key), title: string(service.title) };
    }),
    consent: { version: string(consent.version), noticeUrl: noticeUrl.href },
  };
}

export async function loadSlots(
  date: string,
  zone: string,
  signal: AbortSignal,
): Promise<Slot[]> {
  const data = record(
    await json(`slots?date=${encodeURIComponent(date)}`, { signal }),
  );
  if (
    data.date !== date ||
    data.timezone !== zone ||
    !Array.isArray(data.slots)
  )
    throw new Error("Invalid availability response");
  return data.slots.map(slot);
}

export async function submitBooking(
  input: BookingInput,
  key: string,
): Promise<Receipt> {
  const data = record(
    await json("appointments", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(input),
    }),
  );
  const bookedSlot = slot(data.slot);
  if (data.status !== "pending" || bookedSlot.id !== input.slotId)
    throw new Error("Invalid booking receipt");
  const telegramLink =
    data.telegramLink === undefined ? undefined : string(data.telegramLink);
  if (
    telegramLink &&
    !/^https:\/\/t\.me\/[A-Za-z][A-Za-z0-9_]{4,31}\?start=[A-Za-z0-9_-]{43}$/.test(
      telegramLink,
    )
  )
    throw new Error("Invalid Telegram link");
  return {
    id: string(data.id),
    reference: string(data.reference),
    status: "pending",
    revision: integer(data.revision),
    slot: bookedSlot,
    timezone: timezone(data.timezone),
    ...(telegramLink ? { telegramLink } : {}),
  };
}

export function submissionKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export function dateBounds(zone: string, days: number) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format();
  const last = new Date(`${today}T12:00:00Z`);
  last.setUTCDate(last.getUTCDate() + days);
  return { min: today, max: last.toISOString().slice(0, 10) };
}

export function displaySlot(value: Slot, zone: string): string {
  return new Intl.DateTimeFormat("ru", {
    timeZone: zone,
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value.start));
}
