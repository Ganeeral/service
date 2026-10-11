import { Injectable } from "@nestjs/common";

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Missing ${key}`);
  return value;
}

function integer(
  env: NodeJS.ProcessEnv,
  key: string,
  min: number,
  max: number,
): number {
  const raw = required(env, key);
  const value = Number(raw);
  if (
    !/^\d+$/.test(raw) ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new Error(`Invalid ${key}`);
  }
  return value;
}

@Injectable()
export class Config {
  readonly environment: string;
  readonly databaseUrl: string;
  readonly port: number;
  readonly origin: string;
  readonly timezone: string;
  readonly noticeMinutes: number;
  readonly horizonDays: number;
  readonly windowMinutes: number;
  readonly consentVersion: string;
  readonly consentNoticeUrl: string;
  readonly ownerIds: ReadonlySet<string>;
  readonly publicBookingEnabled: boolean;
  readonly telegramEnabled: boolean;
  readonly botToken: string;
  readonly botUsername: string;
  readonly webhookSecret: string;
  readonly servicePhone: string;
  readonly serviceAddress: string;
  readonly directionsUrl: string;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.environment = env.NODE_ENV ?? "development";
    if (!["true", "false"].includes(env.PUBLIC_BOOKING_ENABLED ?? "false"))
      throw new Error("Invalid PUBLIC_BOOKING_ENABLED");
    this.publicBookingEnabled = env.PUBLIC_BOOKING_ENABLED === "true";
    this.databaseUrl = required(env, "DATABASE_URL");
    const database = new URL(this.databaseUrl);
    if (!["postgres:", "postgresql:"].includes(database.protocol))
      throw new Error("Invalid DATABASE_URL protocol");
    this.port = integer({ ...env, PORT: env.PORT ?? "3008" }, "PORT", 1, 65535);
    const origin = new URL(required(env, "PUBLIC_ORIGIN"));
    if (
      !["http:", "https:"].includes(origin.protocol) ||
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash
    )
      throw new Error("Invalid PUBLIC_ORIGIN");
    this.origin = origin.origin;
    this.timezone = required(env, "SERVICE_TIMEZONE");
    new Intl.DateTimeFormat("en", { timeZone: this.timezone }).format();
    this.noticeMinutes = integer(env, "BOOKING_NOTICE_MINUTES", 0, 10080);
    this.horizonDays = integer(env, "BOOKING_HORIZON_DAYS", 1, 365);
    this.windowMinutes = integer(env, "INTAKE_WINDOW_MINUTES", 5, 240);
    this.consentVersion = required(env, "CONSENT_VERSION");
    if (this.consentVersion.length > 100)
      throw new Error("Invalid CONSENT_VERSION");
    const notice = new URL(required(env, "CONSENT_NOTICE_URL"));
    if (notice.origin !== this.origin || notice.username || notice.password)
      throw new Error("CONSENT_NOTICE_URL must use PUBLIC_ORIGIN");
    this.consentNoticeUrl = notice.href;
    if (
      env.NODE_ENV === "production" &&
      (origin.protocol !== "https:" ||
        /development|placeholder|TBD/i.test(
          this.consentVersion + notice.href,
        ) ||
        this.consentVersion.startsWith("test-") ||
        notice.pathname === "/booking-test-notice")
    ) {
      throw new Error(
        "Production requires HTTPS and an approved consent notice/version",
      );
    }
    const owners = (env.OWNER_TELEGRAM_IDS ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    if (owners.some((id) => !/^[1-9]\d{0,19}$/.test(id)))
      throw new Error("Invalid OWNER_TELEGRAM_IDS");
    this.ownerIds = new Set(owners);
    if (!["true", "false"].includes(env.TELEGRAM_ENABLED ?? "false"))
      throw new Error("Invalid TELEGRAM_ENABLED");
    this.telegramEnabled = env.TELEGRAM_ENABLED === "true";
    this.botToken = env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
    this.botUsername = env.TELEGRAM_BOT_USERNAME?.trim() ?? "";
    this.webhookSecret = env.TELEGRAM_WEBHOOK_SECRET?.trim() ?? "";
    if (
      this.telegramEnabled &&
      (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(this.botToken) ||
        !/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(this.botUsername) ||
        !/^[A-Za-z0-9_-]{32,256}$/.test(this.webhookSecret) ||
        !owners.length)
    )
      throw new Error(
        "Telegram requires token, username, webhook secret and owner IDs",
      );
    this.servicePhone = env.SERVICE_PHONE?.trim() ?? "";
    this.serviceAddress = env.SERVICE_ADDRESS?.trim() ?? "";
    this.directionsUrl = env.SERVICE_DIRECTIONS_URL?.trim() ?? "";
    if (this.servicePhone && !/^\+[1-9]\d{9,14}$/.test(this.servicePhone))
      throw new Error("Invalid SERVICE_PHONE");
    if (this.serviceAddress.length > 300)
      throw new Error("Invalid SERVICE_ADDRESS");
    if (this.directionsUrl) {
      const url = new URL(this.directionsUrl);
      if (url.protocol !== "https:" || url.username || url.password)
        throw new Error("Invalid SERVICE_DIRECTIONS_URL");
    }
  }
}
