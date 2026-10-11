import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { DatabaseError, PoolClient } from "pg";
import { Config } from "./config";
import { Database } from "./database";
import { EncryptedLink, issueLink, recoverLink } from "./telegram-link";
import {
  bookingInput,
  instant,
  invalid,
  localDate,
  requestKey,
  text,
  uuid,
} from "./validation";

export type Status =
  "pending" | "confirmed" | "rejected" | "cancelled" | "completed" | "no_show";
export type Actor = { kind: "operator" | "owner" | "customer"; id: string };
export type BookingSettings = {
  noticeMinutes: number;
  horizonDays: number;
  windowMinutes: number;
  revision: number;
  updatedAt: Date;
  updatedBy: string | null;
};
export type BookingSettingField =
  "noticeMinutes" | "horizonDays" | "windowMinutes";
export const bookingSettingFields = {
  noticeMinutes: {
    column: "notice_minutes",
    title: "Минимум до визита",
    unit: "мин",
    min: 0,
    max: 10080,
  },
  horizonDays: {
    column: "horizon_days",
    title: "Запись вперёд",
    unit: "дней",
    min: 1,
    max: 365,
  },
  windowMinutes: {
    column: "window_minutes",
    title: "Длительность окна",
    unit: "мин",
    min: 5,
    max: 240,
  },
} as const;
type Slot = { id: string; start_at: Date; end_at: Date; published: boolean };
type Appointment = {
  id: string;
  reference: string;
  slot_id: string;
  status: Status;
  revision: number;
  telegram_user_id: string | null;
};
type Result = {
  id: string;
  reference: string;
  status: Status;
  revision: number;
  slot: { id: string; start: string; end: string };
  timezone: string;
  telegramLink?: string;
};
export type AppointmentDetail = Appointment & {
  start_at: Date;
  end_at: Date;
  created_at: Date;
  name: string;
  phone_normalized: string;
  telegram_username: string | null;
  vehicle_make: string;
  vehicle_model: string;
  vehicle_year: number | null;
  mileage: number | null;
  service_title: string;
  problem: string;
  source: string;
  internal_note: string;
};
const active = (status: Status) =>
  status === "pending" || status === "confirmed";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const slotView = (slot: Slot) => ({
  id: slot.id,
  start: slot.start_at.toISOString(),
  end: slot.end_at.toISOString(),
});

@Injectable()
export class BookingService {
  constructor(
    private readonly db: Database,
    private readonly config: Config,
  ) {}

  private owner(actor: Actor): void {
    if (actor.kind === "operator" && actor.id === "local-cli") return;
    if (actor.kind !== "owner" || !this.config.ownerIds.has(actor.id))
      throw new ForbiddenException({ code: "FORBIDDEN" });
  }

  private async policy(
    lock: "" | "FOR SHARE" | "FOR UPDATE" = "",
  ): Promise<BookingSettings> {
    const row = (
      await this.db.query<BookingSettings>(
        `SELECT notice_minutes AS "noticeMinutes", horizon_days AS "horizonDays", window_minutes AS "windowMinutes", revision, updated_at AS "updatedAt", updated_by AS "updatedBy" FROM booking_settings WHERE singleton ${lock}`,
      )
    ).rows[0];
    if (!row) throw new Error("Missing booking settings");
    return row;
  }

  async bookingSettings(actor: Actor) {
    this.owner(actor);
    return this.policy();
  }

  async updateBookingSettings(
    field: BookingSettingField,
    value: unknown,
    revision: number,
    actor: Actor,
  ) {
    this.owner(actor);
    if (!Object.hasOwn(bookingSettingFields, field)) invalid("setting");
    const definition = bookingSettingFields[field];
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < definition.min ||
      value > definition.max
    )
      invalid(field);
    if (!Number.isSafeInteger(revision) || revision < 1) invalid("revision");
    return this.db.transaction(async (client) => {
      const current = await this.policy("FOR UPDATE");
      if (current.revision !== revision || current[field] === value)
        return { changed: false, settings: current };
      await client.query(
        `UPDATE booking_settings SET ${definition.column}=$1, revision=revision+1, updated_at=now(), updated_by=$2 WHERE singleton`,
        [value, actor.id],
      );
      return { changed: true, settings: await this.policy() };
    });
  }

  async options() {
    const policy = await this.policy();
    const services = await this.db.query<{ key: string; title: string }>(
      "SELECT key, title FROM service_catalog WHERE enabled ORDER BY key",
    );
    return {
      enabled: this.config.publicBookingEnabled,
      timezone: this.config.timezone,
      noticeMinutes: policy.noticeMinutes,
      horizonDays: policy.horizonDays,
      windowMinutes: policy.windowMinutes,
      services: services.rows,
      consent: {
        version: this.config.consentVersion,
        noticeUrl: this.config.consentNoticeUrl,
      },
    };
  }

  async availability(date: unknown) {
    const day = localDate(date);
    const policy = await this.policy();
    const slots = await this.db.query<Slot>(
      `
      SELECT s.* FROM intake_slots s
      WHERE s.published AND (s.start_at AT TIME ZONE $3)::date = $4::date
        AND s.start_at >= now() + $1 * interval '1 minute'
        AND (s.start_at AT TIME ZONE $3)::date <= (now() AT TIME ZONE $3)::date + $2::integer
        AND NOT EXISTS (SELECT 1 FROM closed_dates d WHERE d.day = $4::date AND d.closed)
        AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.slot_id = s.id AND a.status IN ('pending', 'confirmed'))
      ORDER BY s.start_at`,
      [policy.noticeMinutes, policy.horizonDays, this.config.timezone, day],
    );
    return {
      date: day,
      timezone: this.config.timezone,
      slots: slots.rows.map(slotView),
    };
  }

  private async eligible(client: PoolClient, slotId: string): Promise<Slot> {
    const policy = await this.policy("FOR SHARE");
    const found = await client.query<Slot>(
      "SELECT * FROM intake_slots WHERE id = $1",
      [slotId],
    );
    const slot = found.rows[0];
    if (!slot) throw new ConflictException({ code: "SLOT_UNAVAILABLE" });
    const eligible = await client.query(
      `
      SELECT 1 FROM intake_slots s WHERE id = $1 AND published
        AND start_at >= clock_timestamp() + $2 * interval '1 minute'
        AND (start_at AT TIME ZONE $4)::date <= (clock_timestamp() AT TIME ZONE $4)::date + $3::integer
        AND NOT EXISTS (SELECT 1 FROM closed_dates d WHERE d.closed AND d.day = (s.start_at AT TIME ZONE $4)::date)
        AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.slot_id = s.id AND a.status IN ('pending', 'confirmed'))`,
      [slotId, policy.noticeMinutes, policy.horizonDays, this.config.timezone],
    );
    if (!eligible.rowCount)
      throw new ConflictException({ code: "SLOT_UNAVAILABLE" });
    return slot;
  }

  private result(appointment: Appointment, slot: Slot): Result {
    return {
      id: appointment.id,
      reference: appointment.reference,
      status: appointment.status,
      revision: appointment.revision,
      slot: slotView(slot),
      timezone: this.config.timezone,
    };
  }

  private async event(
    client: PoolClient,
    appointment: Appointment,
    actor: Actor | { kind: "web"; id: null },
    operation: string,
    old: Appointment | null,
    reason: string | null,
  ) {
    const eventId = randomUUID();
    await client.query(
      `INSERT INTO appointment_events (id, appointment_id, revision, actor_kind, actor_id, operation, old_status, new_status, old_slot_id, new_slot_id, reason)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        eventId,
        appointment.id,
        appointment.revision,
        actor.kind,
        actor.id,
        operation,
        old?.status ?? null,
        appointment.status,
        old?.slot_id ?? null,
        appointment.slot_id,
        reason,
      ],
    );
    // Recipient references contain no copied PII; the sender resolves the current revision/binding.
    for (const recipient of ["owner", "customer"]) {
      await client.query(
        "INSERT INTO notification_jobs (id, event_id, recipient) VALUES ($1,$2,$3)",
        [randomUUID(), eventId, recipient],
      );
    }
  }

  async submit(input: unknown, key: unknown, actor?: Actor): Promise<Result> {
    if (actor) this.owner(actor);
    const data = bookingInput(input, this.config.timezone);
    const capability = requestKey(key);
    const keyHash = hash(capability);
    const fingerprint = hash(
      JSON.stringify({
        ...data,
        source: actor ? "manual" : "web",
        actor: actor ?? null,
      }),
    );
    try {
      return await this.db.transaction(async (client) => {
        // Same-key requests serialize across processes; only the hash is stored or locked.
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [keyHash],
        );
        const saved = await client.query<{
          fingerprint: string;
          result: Result;
          telegram_link_encrypted: EncryptedLink | null;
        }>(
          "SELECT fingerprint, result, telegram_link_encrypted FROM submission_requests WHERE key_hash = $1",
          [keyHash],
        );
        const previous = saved.rows[0];
        if (previous) {
          if (previous.fingerprint !== fingerprint)
            throw new ConflictException({ code: "IDEMPOTENCY_CONFLICT" });
          return {
            ...previous.result,
            ...(previous.telegram_link_encrypted
              ? {
                  telegramLink: recoverLink(
                    previous.telegram_link_encrypted,
                    capability,
                  ),
                }
              : {}),
          };
        }
        if (!actor && !this.config.publicBookingEnabled)
          throw new ConflictException({ code: "BOOKING_DISABLED" });
        if (data.consentVersion !== this.config.consentVersion)
          throw new ConflictException({ code: "CONSENT_CHANGED" });
        const service = await client.query<{ title: string }>(
          "SELECT title FROM service_catalog WHERE key = $1 AND enabled FOR SHARE",
          [data.serviceKey],
        );
        if (!service.rows[0]) invalid("serviceKey");
        await client.query(
          "SELECT id FROM intake_slots WHERE id = $1 FOR UPDATE",
          [data.slotId],
        );
        const slot = await this.eligible(client, data.slotId);
        const id = randomUUID();
        const reference = `IL-${randomBytes(8).toString("hex").toUpperCase()}`;
        const savedAppointment = await client.query<Appointment>(
          `
          INSERT INTO appointments (id, reference, slot_id, status, source, name, phone_original, phone_normalized, telegram_username, vehicle_make, vehicle_model, vehicle_year, mileage, service_key, service_title, problem, consent_version)
          VALUES ($1,$2,$3,'pending',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
          RETURNING id, reference, slot_id, status, revision, telegram_user_id`,
          [
            id,
            reference,
            data.slotId,
            actor ? "manual" : "web",
            data.name,
            data.phoneOriginal,
            data.phoneNormalized,
            data.telegramUsername,
            data.make,
            data.model,
            data.year,
            data.mileage,
            data.serviceKey,
            service.rows[0].title,
            data.problem,
            data.consentVersion,
          ],
        );
        const appointment = savedAppointment.rows[0]!;
        await this.event(
          client,
          appointment,
          actor ?? { kind: "web", id: null },
          "created",
          null,
          null,
        );
        const result = this.result(appointment, slot);
        const link =
          !actor && this.config.telegramEnabled
            ? await issueLink(client, id, this.config.botUsername, capability)
            : null;
        await client.query(
          "INSERT INTO submission_requests (key_hash, fingerprint, result, appointment_id, telegram_link_encrypted) VALUES ($1,$2,$3,$4,$5)",
          [keyHash, fingerprint, result, id, link?.encrypted ?? null],
        );
        return { ...result, ...(link ? { telegramLink: link.url } : {}) };
      });
    } catch (error) {
      if (
        error instanceof DatabaseError &&
        error.code === "23505" &&
        error.constraint === "one_active_appointment_per_slot"
      )
        throw new ConflictException({ code: "SLOT_UNAVAILABLE" });
      throw error;
    }
  }

  async changeStatus(
    id: unknown,
    target: Status,
    expectedRevision: number,
    actor: Actor,
    reason?: string,
  ): Promise<Result> {
    uuid(id, "appointmentId");
    if (actor.kind !== "customer") this.owner(actor);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
      invalid("revision");
    if (
      !["confirmed", "rejected", "cancelled", "completed", "no_show"].includes(
        target,
      )
    )
      invalid("status");
    const detail =
      reason === undefined ? null : text(reason, "reason", 0, 1000);
    return this.db.transaction(async (client) => {
      const rows = await client.query<Appointment>(
        "SELECT id, reference, slot_id, status, revision, telegram_user_id FROM appointments WHERE id = $1 FOR UPDATE",
        [id],
      );
      const before = rows.rows[0];
      if (!before) throw new NotFoundException({ code: "NOT_FOUND" });
      if (
        actor.kind === "customer" &&
        (!before.telegram_user_id ||
          before.telegram_user_id !== actor.id ||
          target !== "cancelled")
      )
        throw new ForbiddenException({ code: "FORBIDDEN" });
      const slot = (
        await client.query<Slot>(
          "SELECT * FROM intake_slots WHERE id = $1 FOR UPDATE",
          [before.slot_id],
        )
      ).rows[0]!;
      if (before.revision !== expectedRevision || before.status === target)
        return this.result(before, slot);
      const allowed =
        before.status === "pending"
          ? ["confirmed", "rejected", "cancelled"]
          : before.status === "confirmed"
            ? ["cancelled", "completed", "no_show"]
            : [];
      if (!allowed.includes(target))
        throw new ConflictException({ code: "INVALID_TRANSITION" });
      const now = (
        await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")
      ).rows[0]!.now;
      if (actor.kind === "customer" && slot.start_at <= now)
        throw new ConflictException({ code: "CANCELLATION_CLOSED" });
      if (
        (target === "completed" || target === "no_show") &&
        slot.start_at > now
      )
        throw new ConflictException({ code: "ARRIVAL_NOT_STARTED" });
      if (
        (target === "rejected" ||
          (target === "cancelled" && actor.kind !== "customer")) &&
        !detail
      )
        invalid("reason");
      const after = (
        await client.query<Appointment>(
          "UPDATE appointments SET status = $2, revision = revision + 1, updated_at = now() WHERE id = $1 RETURNING id, reference, slot_id, status, revision, telegram_user_id",
          [id, target],
        )
      ).rows[0]!;
      await this.event(client, after, actor, "status_changed", before, detail);
      return this.result(after, slot);
    });
  }

  async reschedule(
    id: unknown,
    targetId: unknown,
    expectedRevision: number,
    actor: Actor,
    reason: unknown,
  ): Promise<Result> {
    this.owner(actor);
    const appointmentId = uuid(id, "appointmentId");
    const slotId = uuid(targetId, "slotId");
    const detail = text(reason, "reason", 1, 1000);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
      invalid("revision");
    return this.db.transaction(async (client) => {
      const before = (
        await client.query<Appointment>(
          "SELECT id, reference, slot_id, status, revision, telegram_user_id FROM appointments WHERE id = $1 FOR UPDATE",
          [appointmentId],
        )
      ).rows[0];
      if (!before) throw new NotFoundException({ code: "NOT_FOUND" });
      // Different simultaneous moves acquire slot locks in the same order.
      const slots = await client.query<Slot>(
        "SELECT * FROM intake_slots WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE",
        [[before.slot_id, slotId]],
      );
      const original = slots.rows.find((slot) => slot.id === before.slot_id)!;
      if (before.revision !== expectedRevision || before.slot_id === slotId)
        return this.result(before, original);
      if (!active(before.status))
        throw new ConflictException({ code: "INVALID_TRANSITION" });
      const target = await this.eligible(client, slotId);
      const after = (
        await client.query<Appointment>(
          "UPDATE appointments SET slot_id = $2, revision = revision + 1, updated_at = now() WHERE id = $1 RETURNING id, reference, slot_id, status, revision, telegram_user_id",
          [appointmentId, slotId],
        )
      ).rows[0]!;
      await this.event(client, after, actor, "rescheduled", before, detail);
      return this.result(after, target);
    });
  }

  async configureService(
    key: unknown,
    title: unknown,
    enabled: boolean,
    actor: Actor,
  ) {
    this.owner(actor);
    const serviceKey = text(key, "key", 1, 60);
    if (!/^[a-z][a-z0-9_-]*$/.test(serviceKey) || typeof enabled !== "boolean")
      invalid("service");
    await this.db.query(
      "INSERT INTO service_catalog (key, title, enabled) VALUES ($1,$2,$3) ON CONFLICT (key) DO UPDATE SET title = EXCLUDED.title, enabled = EXCLUDED.enabled",
      [serviceKey, text(title, "title", 1, 120), enabled],
    );
  }

  private day(date: Date): string {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: this.config.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  }

  private async lockDays(client: PoolClient, days: string[]): Promise<void> {
    // Date rows serialize closing/reopening with publication, independently of slot overlap constraints.
    for (const day of [...new Set(days)].sort()) {
      await client.query(
        "INSERT INTO closed_dates (day) VALUES ($1) ON CONFLICT DO NOTHING",
        [day],
      );
      await client.query(
        "SELECT day FROM closed_dates WHERE day = $1 FOR UPDATE",
        [day],
      );
    }
  }

  async publishWindows(
    startInput: unknown,
    endInput: unknown,
    actor: Actor,
    expectedSettingsRevision?: number,
  ) {
    this.owner(actor);
    const start = instant(startInput, "start");
    const end = instant(endInput, "end");
    if (
      expectedSettingsRevision !== undefined &&
      (!Number.isSafeInteger(expectedSettingsRevision) ||
        expectedSettingsRevision < 1)
    )
      invalid("settingsRevision");
    try {
      return await this.db.transaction(async (client) => {
        const policy = await this.policy("FOR SHARE");
        if (
          expectedSettingsRevision !== undefined &&
          policy.revision !== expectedSettingsRevision
        )
          throw new ConflictException({ code: "SETTINGS_CHANGED" });
        const duration = policy.windowMinutes * 60_000;
        const count = (end.getTime() - start.getTime()) / duration;
        if (!Number.isInteger(count) || count < 1 || count > 96) invalid("end");
        const starts = Array.from(
          { length: count },
          (_, i) => new Date(start.getTime() + i * duration),
        );
        await this.lockDays(
          client,
          starts.map((date) => this.day(date)),
        );
        const now = (
          await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")
        ).rows[0]!.now;
        if (start <= now) invalid("start");
        const closed = await client.query(
          "SELECT 1 FROM closed_dates WHERE day = ANY($1::date[]) AND closed",
          [starts.map((date) => this.day(date))],
        );
        if (closed.rowCount)
          throw new ConflictException({ code: "DATE_CLOSED" });
        const slots: ReturnType<typeof slotView>[] = [];
        for (const date of starts) {
          const slot = (
            await client.query<Slot>(
              "INSERT INTO intake_slots (id, start_at, end_at, published) VALUES ($1,$2,$3,true) RETURNING *",
              [randomUUID(), date, new Date(date.getTime() + duration)],
            )
          ).rows[0]!;
          slots.push(slotView(slot));
        }
        return slots;
      });
    } catch (error) {
      if (error instanceof DatabaseError && error.code === "23P01")
        throw new ConflictException({ code: "WINDOW_OVERLAP" });
      throw error;
    }
  }

  async setPublished(
    input: unknown,
    published: boolean,
    actor: Actor,
  ): Promise<void> {
    this.owner(actor);
    const id = uuid(input, "slotId");
    if (typeof published !== "boolean") invalid("published");
    await this.db.transaction(async (client) => {
      const slot = (
        await client.query<Slot>("SELECT * FROM intake_slots WHERE id = $1", [
          id,
        ])
      ).rows[0];
      if (!slot) throw new NotFoundException({ code: "NOT_FOUND" });
      await this.lockDays(client, [this.day(slot.start_at)]);
      if (
        published &&
        (
          await client.query(
            "SELECT 1 FROM closed_dates WHERE day = $1 AND closed",
            [this.day(slot.start_at)],
          )
        ).rowCount
      )
        throw new ConflictException({ code: "DATE_CLOSED" });
      await client.query(
        "SELECT id FROM intake_slots WHERE id = $1 FOR UPDATE",
        [id],
      );
      if (
        !published &&
        (
          await client.query(
            "SELECT 1 FROM appointments WHERE slot_id = $1 AND status IN ('pending', 'confirmed')",
            [id],
          )
        ).rowCount
      )
        throw new ConflictException({ code: "SLOT_OCCUPIED" });
      await client.query(
        "UPDATE intake_slots SET published = $2 WHERE id = $1",
        [id, published],
      );
    });
  }

  async closeDate(
    input: unknown,
    closed: boolean,
    actor: Actor,
  ): Promise<void> {
    this.owner(actor);
    const day = localDate(input);
    if (typeof closed !== "boolean") invalid("closed");
    await this.db.transaction(async (client) => {
      await this.lockDays(client, [day]);
      await client.query("UPDATE closed_dates SET closed = $2 WHERE day = $1", [
        day,
        closed,
      ]);
      if (closed) {
        await client.query(
          "SELECT id FROM intake_slots WHERE (start_at AT TIME ZONE $2)::date = $1 ORDER BY id FOR UPDATE",
          [day, this.config.timezone],
        );
        await client.query(
          "UPDATE intake_slots SET published = false WHERE (start_at AT TIME ZONE $2)::date = $1",
          [day, this.config.timezone],
        );
      }
    });
  }

  async detail(id: unknown, actor: Actor): Promise<AppointmentDetail> {
    if (actor.kind !== "customer") this.owner(actor);
    const row = (
      await this.db.query<AppointmentDetail>(
        `SELECT a.*, s.start_at, s.end_at FROM appointments a JOIN intake_slots s ON s.id = a.slot_id WHERE a.id = $1`,
        [uuid(id, "appointmentId")],
      )
    ).rows[0];
    if (!row) throw new NotFoundException({ code: "NOT_FOUND" });
    if (actor.kind === "customer" && row.telegram_user_id !== actor.id)
      throw new ForbiddenException({ code: "FORBIDDEN" });
    return actor.kind === "customer" ? { ...row, internal_note: "" } : row;
  }

  async list(
    actor: Actor,
    filter: "pending" | "today" | "week" | "mine",
    offset = 0,
  ) {
    if (actor.kind !== "customer") this.owner(actor);
    if (actor.kind === "customer" && filter !== "mine")
      throw new ForbiddenException({ code: "FORBIDDEN" });
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000)
      invalid("offset");
    const rows = await this.db.query<{ id: string }>(
      `
      SELECT a.id FROM appointments a JOIN intake_slots s ON s.id = a.slot_id
      WHERE ($1 != 'customer' OR a.telegram_user_id = $2)
        AND ($3 != 'mine' OR a.telegram_user_id = $2)
        AND ($3 != 'pending' OR a.status = 'pending')
        AND ($3 NOT IN ('today','week') OR (s.start_at AT TIME ZONE $4)::date BETWEEN (now() AT TIME ZONE $4)::date AND (now() AT TIME ZONE $4)::date + CASE WHEN $3 = 'week' THEN 6 ELSE 0 END)
      ORDER BY s.start_at DESC, a.id LIMIT 6 OFFSET $5`,
      [actor.kind, actor.id, filter, this.config.timezone, offset],
    );
    return {
      ids: rows.rows.slice(0, 5).map((row) => row.id),
      more: rows.rows.length > 5,
    };
  }

  async windows(date: unknown, actor: Actor) {
    this.owner(actor);
    return (
      await this.db.query<Slot & { occupied: boolean }>(
        `SELECT s.*, EXISTS (SELECT 1 FROM appointments a WHERE a.slot_id=s.id AND a.status IN ('pending','confirmed')) AS occupied FROM intake_slots s WHERE (s.start_at AT TIME ZONE $2)::date=$1::date ORDER BY s.start_at`,
        [localDate(date), this.config.timezone],
      )
    ).rows;
  }

  async setNote(id: unknown, note: unknown, actor: Actor) {
    this.owner(actor);
    const updated = await this.db.query(
      "UPDATE appointments SET internal_note=$2, updated_at=now() WHERE id=$1",
      [uuid(id, "appointmentId"), text(note, "note", 0, 2000)],
    );
    if (!updated.rowCount) throw new NotFoundException({ code: "NOT_FOUND" });
  }
}
