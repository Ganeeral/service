import {
  Body,
  Controller,
  Headers,
  HttpException,
  Injectable,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Post,
  Req,
  HttpCode,
} from "@nestjs/common";
import type { Request } from "express";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  Actor,
  AppointmentDetail,
  BookingService,
  BookingSettingField,
  bookingSettingFields,
  Status,
} from "./booking.service";
import { Config } from "./config";
import { Database } from "./database";
import { TelegramApi, TelegramError } from "./telegram-api";
import { tokenHash } from "./telegram-link";
import {
  bookingInput,
  instant,
  invalid,
  localDate,
  text,
  uuid,
} from "./validation";

type Update = {
  id: number;
  user: string;
  text?: string;
  linkHash?: string;
  callback?: { id: string; data: string };
};
type Button = { text: string; callback_data: string };
type Flow = { nonce: string } & (
  | {
      kind: "status";
      id: string;
      revision: number;
      target: Status;
      step: "reason" | "confirm";
      reason?: string;
    }
  | {
      kind: "move";
      id: string;
      revision: number;
      step: "date" | "slot" | "reason" | "confirm";
      slotId?: string;
      reason?: string;
    }
  | { kind: "note"; id: string }
  | { kind: "publish"; start: string; end: string; settingsRevision: number }
  | {
      kind: "settings";
      field: BookingSettingField;
      revision: number;
      step: "value" | "confirm";
      value?: number;
    }
  | { kind: "windows" }
  | { kind: "visibility"; slotId: string; published: boolean }
  | { kind: "close"; date: string; closed: boolean }
  | { kind: "manual"; step: string; data: Record<string, unknown>; key: string }
);
type WithoutNonce<T> = T extends unknown ? Omit<T, "nonce"> : never;
type Message = {
  id: string;
  chat_id: string;
  audience: "owner" | "customer";
  method: "sendMessage" | "answerCallbackQuery";
  payload: Record<string, unknown>;
  job_id: string | null;
  attempts: number;
  claim_token: string;
};
type Job = {
  id: string;
  recipient: "owner" | "customer";
  appointment_id: string;
  revision: number;
  operation: string;
  reason: string | null;
  old_start: Date | null;
};
const esc = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
const button = (label: string, data: string): Button => ({
  text: label,
  callback_data: data,
});
const labels: Record<Status, string> = {
  pending: "Предварительная заявка",
  confirmed: "Запись подтверждена",
  rejected: "Заявка отклонена",
  cancelled: "Запись отменена",
  completed: "Визит завершён",
  no_show: "Не приехал",
};
const errors: Record<string, string> = {
  INVALID_INPUT:
    "Проверьте формат данных. /help — подсказка, /cancel — выйти из текущего действия.",
  SLOT_UNAVAILABLE:
    "Это окно уже недоступно. Выберите другое; исходная запись сохранена.",
  WINDOW_OVERLAP:
    "Окна пересекаются с существующими. Измените время публикации.",
  DATE_CLOSED: "Дата закрыта для новых записей.",
  SLOT_OCCUPIED:
    "В окне есть запись. Сначала согласуйте её перенос или отмену.",
  INVALID_TRANSITION: "Статус уже изменился. Откройте актуальную карточку.",
  CANCELLATION_CLOSED:
    "Время приёма уже наступило. Свяжитесь с сервисом по телефону.",
  ARRIVAL_NOT_STARTED: "Завершить визит можно после начала окна приёма.",
  FORBIDDEN: "Это действие недоступно.",
  NOT_FOUND: "Запись не найдена.",
  SETTINGS_CHANGED:
    "Настройки записи изменились. Откройте новый предварительный просмотр публикации; окна не созданы.",
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function parseUpdate(input: unknown): Update | null {
  const body = record(input);
  if (
    !body ||
    !Number.isSafeInteger(body.update_id) ||
    Number(body.update_id) < 0
  )
    invalid("update_id");
  const callback = record(body.callback_query);
  const message = record(callback ? callback.message : body.message);
  const sender = record(callback ? callback.from : message?.from);
  const chat = record(message?.chat);
  if (
    !sender ||
    !chat ||
    sender.is_bot !== false ||
    chat.type !== "private" ||
    !Number.isSafeInteger(sender.id) ||
    Number(sender.id) <= 0 ||
    chat.id !== sender.id
  )
    return null;
  const update: Update = {
    id: Number(body.update_id),
    user: String(sender.id),
  };
  if (callback) {
    if (
      typeof callback.id !== "string" ||
      callback.id.length > 100 ||
      typeof callback.data !== "string" ||
      !/^[\x20-\x7e]{1,64}$/.test(callback.data)
    )
      invalid("callback");
    update.callback = { id: callback.id, data: callback.data };
  } else if (typeof message?.text === "string")
    update.text = text(message.text, "message", 1, 4096);
  else return null;
  if (update.text && /^\/start(?:@[A-Za-z0-9_]+)?\s+/.test(update.text)) {
    const token = update.text.split(/\s+/)[1]!;
    update.linkHash = /^[A-Za-z0-9_-]{43}$/.test(token)
      ? tokenHash(token)
      : "invalid";
    delete update.text;
  }
  return update;
}

@Injectable()
export class TelegramService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private stopped = false;
  constructor(
    private readonly db: Database,
    private readonly config: Config,
    private readonly booking: BookingService,
    private readonly api: TelegramApi,
  ) {}

  authenticate(value: unknown) {
    if (!this.config.telegramEnabled)
      throw new NotFoundException({ code: "BOT_DISABLED" });
    if (
      typeof value !== "string" ||
      !/^[A-Za-z0-9_-]{32,256}$/.test(value) ||
      value.length !== this.config.webhookSecret.length ||
      !timingSafeEqual(
        Buffer.from(value),
        Buffer.from(this.config.webhookSecret),
      )
    )
      throw new HttpException({ code: "WEBHOOK_UNAUTHORIZED" }, 403);
  }
  async receive(input: unknown) {
    const update = parseUpdate(input);
    if (!update) return;
    await this.db.query(
      "INSERT INTO telegram_updates (update_id,user_id,payload) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
      [update.id, update.user, update],
    );
  }
  onApplicationBootstrap() {
    if (!this.config.telegramEnabled || this.config.environment === "test")
      return;
    const poll = async () => {
      if (this.stopped) return;
      this.running = this.drain().catch(() => {
        console.error("Telegram worker cycle failed");
      });
      await this.running;
      if (!this.stopped) {
        this.timer = setTimeout(() => void poll(), 1000);
        this.timer.unref();
      }
    };
    this.timer = setTimeout(() => void poll(), 0);
  }
  async onModuleDestroy() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }

  private actor(user: string): Actor {
    return {
      kind: this.config.ownerIds.has(user) ? "owner" : "customer",
      id: user,
    };
  }
  private time(at: Date) {
    return new Intl.DateTimeFormat("ru", {
      timeZone: this.config.timezone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(at);
  }
  private contact() {
    return this.config.servicePhone
      ? `Телефон: ${esc(this.config.servicePhone)}`
      : "Для связи используйте телефон, по которому с вами согласовали запись. Контакты сервиса ещё уточняются.";
  }
  private async queue(
    user: string,
    audience: "owner" | "customer",
    payload: Record<string, unknown>,
    method = "sendMessage",
    jobId: string | null = null,
  ) {
    await this.db.query(
      "INSERT INTO telegram_messages (id,chat_id,audience,method,payload,job_id) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (job_id,chat_id) DO NOTHING",
      [randomUUID(), user, audience, method, payload, jobId],
    );
  }
  private async say(actor: Actor, value: string, keyboard: Button[][] = []) {
    await this.queue(actor.id, actor.kind === "owner" ? "owner" : "customer", {
      text: value,
      parse_mode: "HTML",
      ...(keyboard.length
        ? { reply_markup: { inline_keyboard: keyboard } }
        : {}),
    });
  }
  private menu(actor: Actor) {
    return actor.kind === "owner"
      ? [
          [
            button("Новые заявки", "list:pending:0"),
            button("Сегодня", "list:today:0"),
          ],
          [
            button("Неделя", "list:week:0"),
            button("Свободные окна", "windows"),
          ],
          [
            button("Добавить запись", "manual"),
            button("Проблемы уведомлений", "failures"),
          ],
          [button("Админка на сайте", "web"), button("Помощь", "help")],
          [button("Настройки записи", "settings")],
        ]
      : [
          [button("Мои записи", "list:mine:0")],
          [
            button("Как добраться", "directions"),
            button("Позвонить в сервис", "phone"),
          ],
        ];
  }
  private async settings(actor: Actor, introduction = "") {
    const current = await this.booking.bookingSettings(actor);
    await this.say(
      actor,
      [
        introduction,
        "<b>Настройки записи</b>",
        ...Object.entries(bookingSettingFields).map(
          ([key, field]) =>
            `${field.title}: ${current[key as BookingSettingField]} ${field.unit}`,
        ),
        `Часовой пояс: ${esc(this.config.timezone)}.`,
        "Длительность применяется к новым окнам. Существующие окна и записи сохраняются. Часы приёма задаются опубликованными окнами.",
      ]
        .filter(Boolean)
        .join("\n"),
      Object.entries(bookingSettingFields).map(([key, field]) => [
        button(field.title, `setting:${key}`),
      ]),
    );
  }
  private async card(id: string, actor: Actor, introduction = "") {
    const a = await this.booking.detail(id, actor);
    const owner = actor.kind === "owner";
    const actions: Button[][] = [];
    const tail = `${a.id}:${a.revision}`;
    if (a.status === "pending" && owner)
      actions.push([
        button("Подтвердить", `confirm:${tail}`),
        button("Отклонить", `reject:${tail}`),
      ]);
    if (["pending", "confirmed"].includes(a.status)) {
      if (owner)
        actions.push([
          button("Перенести", `move:${tail}`),
          button("Отменить", `cancel:${tail}`),
        ]);
      else if (a.start_at > new Date())
        actions.push([button("Отменить запись", `cancel:${tail}`)]);
    }
    if (owner && a.status === "confirmed" && a.start_at <= new Date())
      actions.push([
        button("Завершить", `complete:${tail}`),
        button("Не приехал", `noshow:${tail}`),
      ]);
    if (owner) actions.push([button("Заметка владельца", `note:${a.id}`)]);
    const lines = [
      introduction,
      `<b>${labels[a.status]}</b> · ${esc(a.reference)}`,
      `${esc(a.vehicle_make)} ${esc(a.vehicle_model)}${a.vehicle_year ? ` · ${a.vehicle_year}` : ""}${a.mileage !== null ? ` · ${a.mileage} км` : ""}`,
      esc(a.service_title),
      `${this.time(a.start_at)} (${esc(this.config.timezone)})`,
      owner
        ? `Клиент: ${esc(a.name)}\nТелефон: ${esc(a.phone_normalized)}${a.telegram_username ? `\nКонтакт: ${esc(a.telegram_username)}` : ""}\n${a.telegram_user_id ? "Telegram подключён" : "Telegram не подключён — связаться по телефону"}\nИсточник: ${a.source === "manual" ? "Владелец" : "Сайт"}\nСоздана: ${this.time(a.created_at)}`
        : "",
      a.problem ? `Задача: ${esc(a.problem)}` : "",
      owner && a.internal_note
        ? `Заметка владельца: ${esc(a.internal_note)}`
        : "",
      a.status === "pending"
        ? "Пока время предварительное. Дождитесь подтверждения администратора."
        : "",
      this.config.serviceAddress
        ? `Адрес: ${esc(this.config.serviceAddress)}`
        : "",
      owner ? "" : this.contact(),
    ].filter(Boolean);
    // Telegram limits message length; bound long free-text notes before sending.
    const value = lines.join("\n");
    const chunks =
      value.length <= 3900
        ? [value]
        : [lines.slice(0, 6).join("\n"), ...lines.slice(6)];
    for (const [index, chunk] of chunks.entries())
      await this.say(actor, chunk, index === chunks.length - 1 ? actions : []);
  }
  private async saveFlow(
    user: string,
    value: WithoutNonce<Flow> | Flow,
  ): Promise<Flow> {
    const flow = {
      ...value,
      nonce: "nonce" in value ? value.nonce : randomBytes(8).toString("hex"),
    } as Flow;
    await this.db.query(
      "INSERT INTO telegram_flows (user_id,payload,expires_at) VALUES ($1,$2,now()+interval '15 minutes') ON CONFLICT(user_id) DO UPDATE SET payload=EXCLUDED.payload, expires_at=EXCLUDED.expires_at",
      [user, flow],
    );
    return flow;
  }
  private async flow(user: string) {
    return (
      await this.db.query<{ payload: Flow }>(
        "SELECT payload FROM telegram_flows WHERE user_id=$1 AND expires_at>now()",
        [user],
      )
    ).rows[0]?.payload;
  }
  private async preview(actor: Actor, flow: Flow, message: string) {
    await this.say(actor, message, [
      [
        button(
          flow.kind === "manual"
            ? "Согласие клиента получено — сохранить"
            : "Подтвердить действие",
          `ok:${flow.nonce}`,
        ),
      ],
      [button("Назад / отменить действие", `abort:${flow.nonce}`)],
    ]);
  }
  private async link(hash: string, actor: Actor) {
    if (!/^[a-f0-9]{64}$/.test(hash))
      return this.say(
        actor,
        "Ссылка недействительна или истекла. Обратитесь к владельцу сервиса.",
      );
    const link = (
      await this.db.query<{
        appointment_id: string;
        expires_at: Date;
        consumed_by: string | null;
      }>(
        "SELECT * FROM appointment_link_tokens WHERE token_hash=$1 FOR UPDATE",
        [hash],
      )
    ).rows[0];
    if (
      !link ||
      (link.consumed_by && link.consumed_by !== actor.id) ||
      (!link.consumed_by && link.expires_at <= new Date())
    )
      return this.say(
        actor,
        "Ссылка недействительна или истекла. Обратитесь к владельцу сервиса.",
      );
    const appointment = (
      await this.db.query<{ telegram_user_id: string | null }>(
        "SELECT telegram_user_id FROM appointments WHERE id=$1 FOR UPDATE",
        [link.appointment_id],
      )
    ).rows[0]!;
    if (
      appointment.telegram_user_id &&
      appointment.telegram_user_id !== actor.id
    )
      return this.say(
        actor,
        "Ссылка недействительна или истекла. Обратитесь к владельцу сервиса.",
      );
    await this.db.query(
      "UPDATE appointments SET telegram_user_id=$2 WHERE id=$1",
      [link.appointment_id, actor.id],
    );
    await this.db.query(
      "UPDATE appointment_link_tokens SET consumed_at=coalesce(consumed_at,now()), consumed_by=$2 WHERE token_hash=$1",
      [hash, actor.id],
    );
    await this.card(
      link.appointment_id,
      { kind: "customer", id: actor.id },
      "Уведомления подключены. Актуальное состояние заявки:",
    );
  }
  private async list(
    actor: Actor,
    filter: "pending" | "today" | "week" | "mine",
    offset: number,
  ) {
    const result = await this.booking.list(actor, filter, offset);
    if (!result.ids.length)
      await this.say(actor, "Записей в этом списке нет.", this.menu(actor));
    for (const id of result.ids) await this.card(id, actor);
    if (result.more)
      await this.say(actor, "Следующие записи", [
        [button("Показать ещё", `list:${filter}:${offset + 5}`)],
      ]);
  }
  private async windows(actor: Actor, day: string, offset = 0) {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000)
      invalid("offset");
    const rows = await this.booking.windows(day, actor);
    const free = rows.filter((s) => !s.occupied);
    const keyboard = free
      .slice(offset, offset + 30)
      .map((s) => [
        button(
          `${this.time(s.start_at)} · ${s.published ? "Опубликовано" : "Скрыто"}`,
          `visibility:${s.id}:${s.published ? "hide" : "show"}`,
        ),
      ]);
    if (free.length > offset + 30)
      keyboard.push([
        button("Следующие окна", `windowsday:${day}:${offset + 30}`),
      ]);
    await this.say(
      actor,
      `Окна ${esc(day)} (${esc(this.config.timezone)}). ${rows.length ? "Нажмите на свободное окно, чтобы изменить публикацию." : "Пока нет окон."}\n/publish START END — создать серию; время ISO с часовым поясом.`,
      keyboard,
    );
    const occupied = rows.filter((s) => s.occupied);
    if (occupied.length)
      await this.say(
        actor,
        `Занятые окна:\n${occupied.map((s) => this.time(s.start_at)).join("\n")}\nЗакрытие даты сохраняет эти записи; каждую нужно согласовать отдельно.`,
      );
  }
  private async chooseSlots(
    actor: Actor,
    flow: Flow,
    date: string,
    offset = 0,
  ) {
    if (
      actor.kind !== "owner" ||
      !["move", "manual"].includes(flow.kind) ||
      !("step" in flow) ||
      flow.step !== "slot"
    )
      throw new HttpException({ code: "FORBIDDEN" }, 403);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000)
      invalid("offset");
    const slots = (await this.booking.availability(localDate(date))).slots;
    const keyboard = slots
      .slice(offset, offset + 30)
      .map((s) => [
        button(this.time(new Date(s.start)), `slot:${s.id}:${flow.nonce}`),
      ]);
    if (slots.length > offset + 30)
      keyboard.push([
        button("Следующие окна", `slots:${date}:${offset + 30}:${flow.nonce}`),
      ]);
    return this.say(
      actor,
      "Выберите окно приёма. Доступность повторно проверяется при сохранении.",
      keyboard,
    );
  }
  private async failures(actor: Actor, offset = 0) {
    if (actor.kind !== "owner")
      throw new HttpException({ code: "FORBIDDEN" }, 403);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000)
      invalid("offset");
    const inbound = (
      await this.db.query<{ count: string }>(
        "SELECT count(*) FROM telegram_updates WHERE processed_at IS NULL AND attempts>=8",
      )
    ).rows[0]!.count;
    if (Number(inbound))
      await this.say(
        actor,
        `Не обработано входящих обновлений: ${inbound}. Нужна проверка сервера (bot-failures); команды этого пользователя могут ожидать восстановления.`,
      );
    const rows = (
      await this.db.query<{
        id: string;
        chat_id: string;
        last_error_code: string;
        reference: string | null;
        phone_normalized: string | null;
      }>(
        `SELECT m.id,m.chat_id,m.last_error_code,a.reference,a.phone_normalized FROM telegram_messages m LEFT JOIN notification_jobs j ON j.id=m.job_id LEFT JOIN appointment_events e ON e.id=j.event_id LEFT JOIN appointments a ON a.id=e.appointment_id WHERE m.state='failed' ORDER BY m.sequence DESC LIMIT 11 OFFSET $1`,
        [offset],
      )
    ).rows;
    await this.say(
      actor,
      rows.length
        ? "Неотправленные сообщения. После устранения причины можно повторить доставку."
        : "Ошибок доставки нет.",
    );
    for (const row of rows.slice(0, 10))
      await this.say(
        actor,
        `${esc(row.reference ?? "Ответ бота")} · ${esc(row.last_error_code)}${row.phone_normalized ? `\nСвязаться по телефону: ${esc(row.phone_normalized)}` : ""}`,
        [[button("Повторить доставку", `retry:${row.id}`)]],
      );
    if (rows.length > 10)
      await this.say(actor, "Следующие ошибки", [
        [button("Показать ещё", `failures:${offset + 10}`)],
      ]);
  }
  private async help(actor: Actor) {
    await this.say(
      actor,
      actor.kind === "owner"
        ? "<b>Управление сервисом</b>\n/admin — меню\n/settings — настройки записи (окно, горизонт, минимум до визита)\n/pending · /today · /week — записи\n/windows YYYY-MM-DD — все окна даты\n/publish START END — предварительный просмотр серии окон (ISO, например 2027-01-20T10:00:00+03:00; укажите свои реальные времена)\n/close YYYY-MM-DD · /open YYYY-MM-DD — закрыть/открыть дату после подтверждения\n/manual — запись по телефону\n/failures — ошибки отправки\n/web — статус админки сайта\n/cancel — отменить текущий ввод\nВсе времена в зоне сервиса; окно — приём автомобиля, не срок ремонта. При ручной записи согласие клиента нужно получить отдельно."
        : "Мои записи доступны только после Start по ссылке из сохранённой заявки. Отмена — в карточке, до начала приёма. Для переноса свяжитесь с владельцем. /cancel отменяет текущий ввод.",
      this.menu(actor),
    );
  }
  private async handle(update: Update) {
    const actor = this.actor(update.user);
    const value = update.text ?? "";
    if (update.linkHash) return this.link(update.linkHash, actor);
    if (/^\/cancel(?:@[A-Za-z0-9_]+)?$/.test(value)) {
      await this.db.query("DELETE FROM telegram_flows WHERE user_id=$1", [
        actor.id,
      ]);
      return this.say(actor, "Текущее действие отменено.", this.menu(actor));
    }
    if (update.callback) return this.callback(actor, update.callback.data);
    const command = value.split(/\s+/)[0]!.split("@")[0];
    if (["/start", "/admin"].includes(command!)) {
      if (command === "/admin" && actor.kind !== "owner")
        return this.say(actor, "Доступ владельца не предоставлен.");
      return this.say(
        actor,
        `Автосервис «У Илюхи». Ваш Telegram ID: ${actor.id}.`,
        this.menu(actor),
      );
    }
    if (command === "/help") return this.help(actor);
    if (command === "/settings") return this.settings(actor);
    if (["/mine", "/pending", "/today", "/week"].includes(command!))
      return this.list(
        actor,
        command === "/mine"
          ? "mine"
          : (command!.slice(1) as "pending" | "today" | "week"),
        0,
      );
    if (command === "/phone" || value === "Позвонить в сервис")
      return this.say(actor, this.contact());
    if (command === "/directions" || value === "Как добраться")
      return this.say(
        actor,
        this.config.serviceAddress
          ? `Адрес: ${esc(this.config.serviceAddress)}${this.config.directionsUrl ? `\n${esc(this.config.directionsUrl)}` : ""}`
          : "Адрес ещё уточняется. Подтвердите место приёма у владельца.",
      );
    if (value === "Мои записи")
      return this.list({ kind: "customer", id: actor.id }, "mine", 0);
    if (command === "/web")
      return this.say(
        actor,
        actor.kind === "owner"
          ? "Админка сайта будет подключена на следующем этапе. Сейчас управление доступно в этом боте; ссылка входа ещё не выдаётся."
          : "Действие недоступно.",
      );
    if (actor.kind === "owner") {
      const args = value.split(/\s+/).slice(1);
      if (command === "/windows")
        return this.windows(actor, localDate(args[0]));
      if (command === "/publish") {
        const policy = await this.booking.bookingSettings(actor);
        const start = instant(args[0], "start"),
          end = instant(args[1], "end");
        const count =
          (end.getTime() - start.getTime()) / (policy.windowMinutes * 60000);
        if (!Number.isInteger(count) || count < 1 || count > 96) invalid("end");
        const flow = await this.saveFlow(actor.id, {
          kind: "publish",
          start: start.toISOString(),
          end: end.toISOString(),
          settingsRevision: policy.revision,
        });
        const overlaps = (
          await this.db.query<{ count: string }>(
            "SELECT count(*) FROM intake_slots WHERE start_at<$2 AND end_at>$1",
            [start, end],
          )
        ).rows[0]!.count;
        return this.preview(
          actor,
          flow,
          `Опубликовать ${count} окон по ${policy.windowMinutes} минут?\n${this.time(start)} — ${this.time(end)} (${esc(this.config.timezone)})\nПересечений сейчас: ${overlaps}. Пересечения и закрытые даты повторно проверяются при сохранении.`,
        );
      }
      if (command === "/close" || command === "/open") {
        const flow = await this.saveFlow(actor.id, {
          kind: "close",
          date: localDate(args[0]),
          closed: command === "/close",
        });
        return this.preview(
          actor,
          flow,
          `${flow.kind === "close" && flow.closed ? "Закрыть" : "Открыть"} дату ${esc(args[0]!)}? Существующие записи сохранятся. Открытие не публикует скрытые окна автоматически.`,
        );
      }
      if (command === "/manual") return this.startManual(actor);
      if (command === "/failures") return this.failures(actor);
    }
    const flow = await this.flow(actor.id);
    if (flow) return this.continueFlow(actor, flow, value);
    await this.say(
      actor,
      "Выберите действие в меню. /help — помощь.",
      this.menu(actor),
    );
  }
  private async callback(actor: Actor, value: string) {
    const [action, id, version] = value.split(":");
    if (action === "help") return this.help(actor);
    if (action === "detail") return this.card(uuid(id, "appointmentId"), actor);
    if (action === "phone") return this.say(actor, this.contact());
    if (action === "directions")
      return this.say(
        actor,
        this.config.serviceAddress
          ? `${esc(this.config.serviceAddress)}\n${esc(this.config.directionsUrl)}`
          : "Адрес уточняется у владельца.",
      );
    if (action === "list") {
      if (!["pending", "today", "week", "mine"].includes(id!))
        invalid("filter");
      return this.list(
        actor,
        id as "pending" | "today" | "week" | "mine",
        Number(version),
      );
    }
    if (action === "windowsday")
      return this.windows(actor, localDate(id), Number(version));
    if (action === "slots") {
      const current = await this.flow(actor.id);
      if (!current || current.nonce !== value.split(":")[3])
        return this.say(actor, "Это действие истекло.");
      return this.chooseSlots(actor, current, localDate(id), Number(version));
    }
    if (action === "ok" || action === "abort" || action === "slot") {
      const flow = await this.flow(actor.id);
      if (!flow || flow.nonce !== (action === "slot" ? version : id))
        return this.say(
          actor,
          "Это действие истекло. Откройте карточку заново.",
        );
      if (
        actor.kind !== "owner" &&
        (flow.kind !== "status" || flow.target !== "cancelled")
      )
        throw new HttpException({ code: "FORBIDDEN" }, 403);
      if (action === "abort") {
        await this.db.query("DELETE FROM telegram_flows WHERE user_id=$1", [
          actor.id,
        ]);
        return this.say(actor, "Действие отменено.", this.menu(actor));
      }
      if (action === "slot") {
        const slotId = uuid(id, "slotId");
        if (flow.kind === "move" && flow.step === "slot") {
          flow.slotId = slotId;
          flow.step = "reason";
          await this.saveFlow(actor.id, flow);
          return this.say(
            actor,
            "Напишите, с кем и как согласовали новое время. Этот текст увидит клиент.",
          );
        }
        if (flow.kind === "manual" && flow.step === "slot") {
          flow.data.slotId = slotId;
          flow.step = "confirm";
          await this.saveFlow(actor.id, flow);
          return this.manualPreview(actor, flow);
        }
        invalid("flow");
      }
      return this.applyFlow(actor, flow);
    }
    if (
      action === "cancel" ||
      ["confirm", "reject", "complete", "noshow", "move", "note"].includes(
        action!,
      )
    ) {
      const detail = await this.booking.detail(id, actor);
      if (action === "note") {
        if (actor.kind !== "owner")
          throw new HttpException({ code: "FORBIDDEN" }, 403);
        await this.saveFlow(actor.id, { kind: "note", id: detail.id });
        return this.say(
          actor,
          "Введите заметку (до 2000 символов). Она доступна только владельцу. /cancel — выйти.",
        );
      }
      const revision = Number(version);
      if (revision !== detail.revision)
        return this.card(
          detail.id,
          actor,
          "Карточка устарела. Актуальное состояние:",
        );
      if (action === "move") {
        if (actor.kind !== "owner")
          throw new HttpException({ code: "FORBIDDEN" }, 403);
        await this.saveFlow(actor.id, {
          kind: "move",
          id: detail.id,
          revision,
          step: "date",
        });
        return this.say(
          actor,
          "Сначала согласуйте перенос с клиентом. Введите новую дату YYYY-MM-DD.",
        );
      }
      const target = (
        {
          confirm: "confirmed",
          reject: "rejected",
          cancel: "cancelled",
          complete: "completed",
          noshow: "no_show",
        } as const
      )[action as "confirm" | "reject" | "cancel" | "complete" | "noshow"];
      if (actor.kind !== "owner" && target !== "cancelled")
        throw new HttpException({ code: "FORBIDDEN" }, 403);
      const flow = await this.saveFlow(actor.id, {
        kind: "status",
        id: detail.id,
        revision,
        target,
        step:
          actor.kind === "owner" && ["cancelled", "rejected"].includes(target)
            ? "reason"
            : "confirm",
      });
      if (flow.kind === "status" && flow.step === "reason")
        return this.say(
          actor,
          "Напишите причину для клиента. Затем покажу подтверждение.",
        );
      return this.preview(
        actor,
        flow,
        `${labels[target]}?\n${esc(detail.reference)} · ${this.time(detail.start_at)}`,
      );
    }
    if (actor.kind !== "owner")
      throw new HttpException({ code: "FORBIDDEN" }, 403);
    if (action === "settings") return this.settings(actor);
    if (action === "setting") {
      if (!id || !Object.hasOwn(bookingSettingFields, id)) invalid("setting");
      const field = id as BookingSettingField;
      const current = await this.booking.bookingSettings(actor);
      const definition = bookingSettingFields[field];
      await this.saveFlow(actor.id, {
        kind: "settings",
        field,
        revision: current.revision,
        step: "value",
      });
      return this.say(
        actor,
        `${definition.title}: сейчас ${current[field]} ${definition.unit}. Введите целое число от ${definition.min} до ${definition.max}. /cancel — выйти.`,
      );
    }
    if (action === "manual") return this.startManual(actor);
    if (action === "failures")
      return this.failures(actor, id === undefined ? 0 : Number(id));
    if (action === "windows") {
      await this.saveFlow(actor.id, { kind: "windows" });
      return this.say(
        actor,
        "Введите дату YYYY-MM-DD, чтобы открыть окна приёма. /cancel — выйти.",
      );
    }
    if (action === "web")
      return this.say(
        actor,
        "Админка сайта — следующий этап. Пока используйте управление в боте.",
      );
    if (action === "retry") {
      await this.db.query(
        "UPDATE telegram_messages SET state='pending',attempts=0,available_at=now(),last_error_code=NULL WHERE id=$1 AND state='failed'",
        [uuid(id, "messageId")],
      );
      return this.say(
        actor,
        "Повторная доставка поставлена в очередь. Актуальность и доступ будут проверены заново.",
      );
    }
    if (action === "visibility") {
      if (version !== "hide" && version !== "show") invalid("published");
      const flow = await this.saveFlow(actor.id, {
        kind: "visibility",
        slotId: uuid(id, "slotId"),
        published: version === "show",
      });
      return this.preview(
        actor,
        flow,
        `${version === "show" ? "Опубликовать" : "Скрыть"} окно? Занятое окно скрыть нельзя.`,
      );
    }
    invalid("callback");
  }
  private async startManual(actor: Actor) {
    if (actor.kind !== "owner")
      throw new HttpException({ code: "FORBIDDEN" }, 403);
    await this.saveFlow(actor.id, {
      kind: "manual",
      step: "name",
      data: {},
      key: randomBytes(32).toString("base64url"),
    });
    await this.say(
      actor,
      "Запись по телефону. Убедитесь, что клиент согласен на обработку данных. Введите имя клиента. /cancel — выйти.",
    );
  }
  private async manualPreview(
    actor: Actor,
    flow: Extract<Flow, { kind: "manual" }>,
  ) {
    const slot = (
      await this.db.query<{ start_at: Date }>(
        "SELECT start_at FROM intake_slots WHERE id=$1",
        [flow.data.slotId],
      )
    ).rows[0];
    if (!slot) invalid("slotId");
    await this.preview(
      actor,
      flow,
      `Предварительная запись по телефону:\n${esc(String(flow.data.name))} · ${esc(String(flow.data.phone))}\n${esc(String(flow.data.make))} ${esc(String(flow.data.model))}\nУслуга: ${esc(String(flow.data.serviceKey))}\nЗадача: ${esc(String(flow.data.problem))}\n${this.time(slot.start_at)} (${esc(this.config.timezone)})\nСогласие клиента получено отдельно? Версия: ${esc(this.config.consentVersion)}. Подтверждайте только после получения согласия. Telegram клиента не будет привязан автоматически.`,
    );
  }
  private async continueFlow(actor: Actor, flow: Flow, input: string) {
    if (actor.kind !== "owner")
      return this.say(actor, "Для отмены нажмите подтверждение в карточке.");
    if (flow.kind === "windows") {
      const date = localDate(input);
      await this.db.query("DELETE FROM telegram_flows WHERE user_id=$1", [
        actor.id,
      ]);
      return this.windows(actor, date);
    }
    if (flow.kind === "settings" && flow.step === "value") {
      const definition = bookingSettingFields[flow.field];
      if (!/^\d{1,6}$/.test(input)) invalid(flow.field);
      const value = Number(input);
      if (value < definition.min || value > definition.max) invalid(flow.field);
      flow.value = value;
      flow.step = "confirm";
      await this.saveFlow(actor.id, flow);
      return this.preview(
        actor,
        flow,
        `${definition.title}: установить ${value} ${definition.unit}?\nСуществующие окна и записи не изменятся.`,
      );
    }
    if (flow.kind === "note") {
      await this.booking.setNote(flow.id, input === "-" ? "" : input, actor);
      await this.db.query("DELETE FROM telegram_flows WHERE user_id=$1", [
        actor.id,
      ]);
      return this.card(flow.id, actor, "Заметка сохранена.");
    }
    if (flow.kind === "status" && flow.step === "reason") {
      flow.reason = text(input, "reason", 1, 1000);
      flow.step = "confirm";
      await this.saveFlow(actor.id, flow);
      const a = await this.booking.detail(flow.id, actor);
      return this.preview(
        actor,
        flow,
        `${labels[flow.target]}? ${esc(a.reference)}\nПричина для клиента: ${esc(flow.reason)}`,
      );
    }
    if (flow.kind === "move") {
      if (flow.step === "date") {
        const date = localDate(input);
        const slots = await this.booking.availability(date);
        if (!slots.slots.length)
          return this.say(
            actor,
            "На эту дату нет свободных окон. Введите другую дату YYYY-MM-DD.",
          );
        flow.step = "slot";
        await this.saveFlow(actor.id, flow);
        return this.chooseSlots(actor, flow, date);
      }
      if (flow.step === "reason") {
        flow.reason = text(input, "reason", 1, 1000);
        flow.step = "confirm";
        await this.saveFlow(actor.id, flow);
        const old = await this.booking.detail(flow.id, actor);
        const target = (
          await this.db.query<{ start_at: Date }>(
            "SELECT start_at FROM intake_slots WHERE id=$1",
            [flow.slotId],
          )
        ).rows[0];
        if (!target) invalid("slotId");
        return this.preview(
          actor,
          flow,
          `Перенести ${esc(old.reference)}?\nБыло: ${this.time(old.start_at)}\nБудет: ${this.time(target.start_at)}\nСогласование: ${esc(flow.reason)}`,
        );
      }
    }
    if (flow.kind === "manual") {
      const fields = [
        "name",
        "phone",
        "make",
        "model",
        "serviceKey",
        "problem",
        "date",
      ];
      const index = fields.indexOf(flow.step);
      if (index < 0)
        return this.say(
          actor,
          "Выберите окно или подтвердите карточку. /cancel — выйти.",
        );
      if (flow.step === "date") {
        const slots = await this.booking.availability(localDate(input));
        if (!slots.slots.length)
          return this.say(
            actor,
            "Нет свободных окон. Введите другую дату YYYY-MM-DD.",
          );
        flow.step = "slot";
        await this.saveFlow(actor.id, flow);
        return this.chooseSlots(actor, flow, localDate(input));
      }
      const max = (
        {
          name: 80,
          phone: 40,
          make: 60,
          model: 80,
          serviceKey: 60,
          problem: 2000,
        } as Record<string, number>
      )[flow.step]!;
      flow.data[flow.step] =
        input === "-" && flow.step === "problem"
          ? ""
          : text(
              input,
              flow.step,
              flow.step === "problem" ? 0 : flow.step === "name" ? 2 : 1,
              max,
            );
      if (flow.step === "phone") {
        const phone = String(flow.data.phone).replace(/\D/g, "");
        if (!/^(?:[3489]\d{9}|[78][3489]\d{9})$/.test(phone)) invalid("phone");
      }
      if (
        flow.step === "serviceKey" &&
        !(await this.booking.options()).services.some(
          (s) => s.key === flow.data.serviceKey,
        )
      )
        invalid("serviceKey");
      if (
        flow.step === "problem" &&
        flow.data.serviceKey === "unknown" &&
        !flow.data.problem
      )
        invalid("problem");
      flow.step = fields[index + 1]!;
      await this.saveFlow(actor.id, flow);
      const prompts: Record<string, string> = {
        phone: "Введите телефон клиента (+7).",
        make: "Марка автомобиля?",
        model: "Модель автомобиля?",
        problem:
          "Что нужно сделать? До 2000 символов. «-» — без описания, кроме диагностики unknown.",
        date: "Удобная дата YYYY-MM-DD?",
      };
      if (flow.step === "serviceKey")
        return this.say(
          actor,
          `Введите ключ услуги:\n${(await this.booking.options()).services.map((s) => `${s.key} — ${esc(s.title)}`).join("\n")}`,
        );
      return this.say(actor, prompts[flow.step]!);
    }
    await this.say(
      actor,
      "Подтвердите действие в карточке или /cancel — выйти.",
    );
  }
  private async applyFlow(actor: Actor, flow: Flow) {
    if (flow.kind === "status") {
      if (flow.step !== "confirm") invalid("flow");
      await this.booking.changeStatus(
        flow.id,
        flow.target,
        flow.revision,
        actor,
        flow.reason,
      );
      await this.card(flow.id, actor, "Актуальное состояние:");
    } else {
      if (actor.kind !== "owner")
        throw new HttpException({ code: "FORBIDDEN" }, 403);
      if (flow.kind === "move") {
        if (flow.step !== "confirm") invalid("flow");
        await this.booking.reschedule(
          flow.id,
          flow.slotId,
          flow.revision,
          actor,
          flow.reason,
        );
        await this.card(flow.id, actor, "Актуальное состояние после переноса:");
      } else if (flow.kind === "publish") {
        // Persisted previews created before settings support require a fresh review.
        if (!Number.isSafeInteger(flow.settingsRevision))
          throw new HttpException({ code: "SETTINGS_CHANGED" }, 409);
        const slots = await this.booking.publishWindows(
          flow.start,
          flow.end,
          actor,
          flow.settingsRevision,
        );
        await this.say(actor, `Опубликовано окон: ${slots.length}.`);
      } else if (flow.kind === "settings") {
        if (flow.step !== "confirm") invalid("flow");
        const result = await this.booking.updateBookingSettings(
          flow.field,
          flow.value,
          flow.revision,
          actor,
        );
        await this.settings(
          actor,
          result.changed
            ? "Настройки сохранены."
            : "Настройки уже изменены или это значение уже установлено. Актуальные параметры:",
        );
      } else if (flow.kind === "visibility") {
        await this.booking.setPublished(flow.slotId, flow.published, actor);
        await this.say(
          actor,
          flow.published ? "Окно опубликовано." : "Окно скрыто.",
        );
      } else if (flow.kind === "close") {
        await this.booking.closeDate(flow.date, flow.closed, actor);
        await this.say(
          actor,
          `${flow.date}: ${flow.closed ? "закрыта для новых заявок, текущие записи сохранены" : "открыта; скрытые окна публикуйте отдельно"}.`,
        );
      } else if (flow.kind === "manual") {
        if (flow.step !== "confirm") invalid("flow");
        const data = {
          ...flow.data,
          consent: { accepted: true, version: this.config.consentVersion },
        };
        bookingInput(data, this.config.timezone);
        const result = await this.booking.submit(data, flow.key, actor);
        await this.card(
          result.id,
          actor,
          "Предварительная запись сохранена. Подтверждение выполняется отдельно.",
        );
      } else invalid("flow");
    }
    await this.db.query("DELETE FROM telegram_flows WHERE user_id=$1", [
      actor.id,
    ]);
  }
  private async processUpdate(): Promise<boolean> {
    let updateId: number | undefined;
    try {
      return await this.db.transaction(async (client) => {
        const row = (
          await client.query<{ update_id: number; payload: Update }>(
            "SELECT update_id,payload FROM telegram_updates WHERE processed_at IS NULL AND attempts<8 AND available_at<=now() AND NOT EXISTS (SELECT 1 FROM telegram_updates earlier WHERE earlier.user_id=telegram_updates.user_id AND earlier.update_id<telegram_updates.update_id AND earlier.processed_at IS NULL) ORDER BY update_id FOR UPDATE SKIP LOCKED LIMIT 1",
          )
        ).rows[0];
        if (!row) return false;
        updateId = row.update_id;
        const update = row.payload;
        // All state changes, flow steps, replies and deduplication commit together, even across shared services.
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1, 1))",
          [update.user],
        );
        await client.query("SAVEPOINT telegram_command");
        try {
          await this.handle(update);
        } catch (error) {
          if (!(error instanceof HttpException)) throw error;
          await client.query("ROLLBACK TO SAVEPOINT telegram_command");
          const body = record(error.getResponse());
          const code = typeof body?.code === "string" ? body.code : "FORBIDDEN";
          await this.say(
            this.actor(update.user),
            errors[code] ??
              "Действие не выполнено. Проверьте актуальную запись.",
          );
        }
        if (update.callback)
          await this.queue(
            update.user,
            this.config.ownerIds.has(update.user) ? "owner" : "customer",
            { callback_query_id: update.callback.id },
            "answerCallbackQuery",
          );
        await client.query(
          "UPDATE telegram_updates SET processed_at=now(),payload='{}'::jsonb,last_error_code=NULL WHERE update_id=$1",
          [row.update_id],
        );
        return true;
      });
    } catch {
      if (updateId !== undefined)
        await this.db.pool.query(
          "UPDATE telegram_updates SET attempts=attempts+1,available_at=now()+interval '30 seconds',last_error_code='PROCESSING_FAILED' WHERE update_id=$1 AND processed_at IS NULL",
          [updateId],
        );
      console.error("Telegram update processing failed");
      return false;
    }
  }
  private async expandJobs() {
    await this.db.transaction(async (client) => {
      const jobs = (
        await client.query<Job>(
          `SELECT j.id,j.recipient,e.appointment_id,e.revision,e.operation,e.reason,s.start_at AS old_start FROM notification_jobs j JOIN appointment_events e ON e.id=j.event_id LEFT JOIN intake_slots s ON s.id=e.old_slot_id WHERE j.state='pending' AND j.available_at<=now() ORDER BY j.created_at FOR UPDATE OF j SKIP LOCKED LIMIT 20`,
        )
      ).rows;
      for (const job of jobs) {
        const a = (
          await client.query<AppointmentDetail>(
            "SELECT a.*,s.start_at,s.end_at FROM appointments a JOIN intake_slots s ON s.id=a.slot_id WHERE a.id=$1",
            [job.appointment_id],
          )
        ).rows[0]!;
        const users =
          job.recipient === "owner"
            ? [...this.config.ownerIds]
            : a.telegram_user_id
              ? [a.telegram_user_id]
              : [];
        if (job.revision !== a.revision || !users.length) {
          await client.query(
            "UPDATE notification_jobs SET state='skipped',last_error_code=$2 WHERE id=$1",
            [
              job.id,
              job.revision !== a.revision ? "STALE_EVENT" : "CHAT_NOT_LINKED",
            ],
          );
          continue;
        }
        const introduction =
          job.operation === "created"
            ? "Новая предварительная заявка"
            : job.operation === "rescheduled"
              ? `Время приёма изменено. Было: ${job.old_start ? this.time(job.old_start) : "—"}. Стало: ${this.time(a.start_at)}.${job.reason ? `\n${job.reason}` : ""}`
              : job.reason
                ? `Причина: ${job.reason}`
                : "Состояние записи изменилось";
        for (const user of users)
          await this.queue(
            user,
            job.recipient,
            { appointmentId: a.id, revision: job.revision, introduction },
            "sendMessage",
            job.id,
          );
        await client.query(
          "UPDATE notification_jobs SET state='processing',claimed_at=now() WHERE id=$1",
          [job.id],
        );
      }
    });
  }
  private async notificationPayload(
    message: Message,
  ): Promise<Record<string, unknown> | null> {
    if (
      message.audience === "owner" &&
      !this.config.ownerIds.has(message.chat_id)
    )
      return null;
    if (!message.job_id) return message.payload;
    const id = String(message.payload.appointmentId);
    const actor: Actor = { kind: message.audience, id: message.chat_id };
    const a = await this.booking.detail(id, actor);
    if (a.revision !== message.payload.revision) return null;
    const header = `${esc(String(message.payload.introduction))}\n<b>${labels[a.status]}</b> · ${esc(a.reference)}\n${esc(a.vehicle_make)} ${esc(a.vehicle_model)} · ${esc(a.service_title)}\n${this.time(a.start_at)} (${esc(this.config.timezone)})`;
    const tail =
      message.audience === "owner"
        ? `\nКлиент: ${esc(a.name)} · ${esc(a.phone_normalized)}${a.telegram_username ? `\nКонтакт: ${esc(a.telegram_username)}` : ""}\n${a.telegram_user_id ? "Telegram подключён" : "Telegram не подключён — связаться по телефону"}\nЗадача: ${esc(a.problem)}`
        : `\n${a.status === "pending" ? "Время предварительное. Дождитесь подтверждения." : ""}\n${this.config.serviceAddress ? `Адрес: ${esc(this.config.serviceAddress)}` : ""}\n${this.contact()}`;
    return {
      text: header + tail,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[button("Открыть запись", `detail:${a.id}`)]],
      },
    };
  }
  private async sendMessage(): Promise<boolean> {
    const message = await this.db.transaction(async (client) => {
      const row = (
        await client.query<Message>(
          `SELECT * FROM telegram_messages WHERE (state='pending' AND available_at<=now()) OR (state='processing' AND claimed_at<now()-interval '45 seconds') ORDER BY CASE WHEN method='answerCallbackQuery' THEN 0 ELSE 1 END,sequence FOR UPDATE SKIP LOCKED LIMIT 1`,
        )
      ).rows[0];
      if (!row) return null;
      row.claim_token = randomUUID();
      await client.query(
        "UPDATE telegram_messages SET state='processing',claimed_at=now(),claim_token=$2,attempts=attempts+1 WHERE id=$1",
        [row.id, row.claim_token],
      );
      return row;
    });
    if (!message) return false;
    let state = "sent",
      code: string | null = null,
      wait = 0,
      providerId: string | null = null;
    try {
      const payload = await this.notificationPayload(message);
      if (!payload) {
        state = "skipped";
        code = "STALE_OR_REVOKED";
      } else {
        const result = record(
          await this.api.call(
            message.method,
            message.method === "sendMessage"
              ? { ...payload, chat_id: message.chat_id }
              : payload,
          ),
        );
        providerId =
          result && typeof result.message_id === "number"
            ? String(result.message_id)
            : null;
      }
    } catch (error) {
      const safe =
        error instanceof TelegramError
          ? error
          : new TelegramError("DELIVERY_FAILED", false);
      state =
        safe.permanent || message.attempts + 1 >= 8 ? "failed" : "pending";
      code = safe.code;
      wait = Math.max(
        safe.retryAfter,
        Math.min(3600, 2 ** (message.attempts + 1) * 5),
      );
    }
    await this.db.transaction(async (client) => {
      await client.query(
        "UPDATE telegram_messages SET state=$3, last_error_code=$4,provider_message_id=$5,available_at=now()+$6*interval '1 second',claimed_at=NULL,claim_token=NULL WHERE id=$1 AND claim_token=$2",
        [message.id, message.claim_token, state, code, providerId, wait],
      );
      if (message.job_id)
        await client.query(
          `UPDATE notification_jobs SET state=CASE WHEN EXISTS(SELECT 1 FROM telegram_messages WHERE job_id=$1 AND state IN ('pending','processing')) THEN 'processing' WHEN EXISTS(SELECT 1 FROM telegram_messages WHERE job_id=$1 AND state='failed') THEN 'failed' WHEN EXISTS(SELECT 1 FROM telegram_messages WHERE job_id=$1 AND state='sent') THEN 'sent' ELSE 'skipped' END WHERE id=$1`,
          [message.job_id],
        );
    });
    return true;
  }
  async drain() {
    if (!this.config.telegramEnabled) return;
    for (let i = 0; i < 10 && !this.stopped; i++)
      if (!(await this.processUpdate())) break;
    await this.expandJobs();
    for (let i = 0; i < 20 && !this.stopped; i++)
      if (!(await this.sendMessage())) break;
  }
}

@Controller("api/v1/telegram")
export class TelegramController {
  constructor(private readonly telegram: TelegramService) {}
  @Post("webhook")
  @HttpCode(200)
  async webhook(
    @Body() body: unknown,
    @Headers("x-telegram-bot-api-secret-token") secret: unknown,
    @Req() request: Request,
  ) {
    this.telegram.authenticate(secret);
    if (!request.is("application/json"))
      throw new HttpException({ code: "JSON_REQUIRED" }, 415);
    await this.telegram.receive(body);
    return { ok: true };
  }
}
