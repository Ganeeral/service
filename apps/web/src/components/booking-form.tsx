"use client";

import {
  useState,
  useEffect,
  useRef,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { serviceOptions, siteContent } from "@/lib/site-content";
import {
  ApiError,
  loadOptions,
  loadSlots,
  submitBooking,
  submissionKey,
  dateBounds,
  displaySlot,
  type BookingOptions,
  type BookingInput,
  type Receipt,
  type Slot,
} from "@/lib/booking-api";
import { Icon } from "./icon";
import { ServiceDropdown } from "./service-dropdown";
import styles from "./booking-form.module.css";

// ponytail: +7-only phone mask; add country selection when supported countries are approved.
function formatPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  const hasPrefix =
    /^[78]/.test(digits) &&
    (value.trim().startsWith("+") || digits.length !== 10);
  const local = (hasPrefix ? digits.slice(1) : digits).slice(0, 10);
  return `+7${local ? ` (${local.slice(0, 3)}` : ""}${local.length >= 3 ? ")" : ""}${local.length > 3 ? ` ${local.slice(3, 6)}` : ""}${local.length > 6 ? `-${local.slice(6, 8)}` : ""}${local.length > 8 ? `-${local.slice(8, 10)}` : ""}`;
}

function maskPhone(event: ChangeEvent<HTMLInputElement>) {
  const input = event.currentTarget;
  const original = input.value;
  const caret = input.selectionStart ?? original.length;
  const digitsBefore = original.slice(0, caret).replace(/\D/g, "").length;
  const addsPrefix = !/^[78]/.test(original.replace(/\D/g, ""));
  input.value = formatPhone(original);
  const positions = [...input.value.matchAll(/\d/g)];
  const nextCaret =
    caret === original.length
      ? input.value.length
      : (positions[Math.max(0, digitsBefore - 1 + Number(addsPrefix))]?.index ??
          input.value.length - 1) + 1;
  input.setSelectionRange(nextCaret, nextCaret);
}

function skipPhoneSeparators(event: KeyboardEvent<HTMLInputElement>) {
  const input = event.currentTarget;
  const start = input.selectionStart ?? 0;
  if (
    start !== input.selectionEnd ||
    !["Backspace", "Delete"].includes(event.key)
  )
    return;
  const backwards = event.key === "Backspace";
  const digits = [...input.value.matchAll(/\d/g)];
  const digit = backwards
    ? digits.findLast((match) => match.index < start)
    : digits.find((match) => match.index >= start);
  if (!digit) return;
  if (digit.index === 1) {
    if (digits.length > 1) event.preventDefault();
    else input.setSelectionRange(0, input.value.length);
    return;
  }
  input.setSelectionRange(
    backwards ? digit.index : start,
    backwards ? start : digit.index + 1,
  );
}

const fieldMessages: Record<string, string> = {
  make: "Укажите марку автомобиля.",
  model: "Укажите модель автомобиля.",
  name: "Укажите имя — от 2 до 80 символов.",
  phone: "Проверьте номер: +7 (999) 123-45-67.",
  telegram: "Используйте латинские буквы, цифры и подчёркивание.",
  problem: "Опишите, что происходит с машиной.",
  service: "Выберите доступную услугу.",
  date: "Выберите дату в пределах расписания.",
  time: "Выберите свободное окно.",
  consent: "Для отправки нужно согласие на обработку данных.",
};
type Review = {
  input: BookingInput;
  service: string;
  slot: Slot;
  timezone: string;
};

export function BookingForm() {
  const requestedService = useSearchParams().get("service");
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const result = useRef<HTMLElement>(null);
  const attempt = useRef<{ key: string; input: BookingInput } | null>(null);
  const inFlight = useRef(false);
  const [options, setOptions] = useState<BookingOptions | null>(null);
  const [optionsError, setOptionsError] = useState(false);
  const [optionsReload, setOptionsReload] = useState(0);
  const [date, setDate] = useState("");
  const [availability, setAvailability] = useState<{
    date: string;
    slots: Slot[];
  } | null>(null);
  const [availabilityError, setAvailabilityError] = useState<string | null>(
    null,
  );
  const [slotsReload, setSlotsReload] = useState(0);
  const [slotId, setSlotId] = useState("");
  const [storedStage, setStage] = useState<
    "editing" | "review" | "sending" | "uncertain" | "saved"
  >("editing");
  const [review, setReview] = useState<Review | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const services =
    options?.services.map((service) => ({
      id: service.key,
      title: service.title,
      description:
        serviceOptions.find((item) => item.id === service.key)?.description ??
        "Опишите задачу — обсудим детали при приёме.",
    })) ?? [];
  const locked =
    storedStage === "sending" ||
    storedStage === "uncertain" ||
    storedStage === "saved";
  const activeService = locked ? review?.input.serviceKey : requestedService;
  const service = services.some((item) => item.id === activeService)
    ? (activeService ?? "")
    : "";
  const bounds = options
    ? dateBounds(options.timezone, options.horizonDays)
    : null;
  const validDate = Boolean(
    bounds &&
    date >= bounds.min &&
    date <= bounds.max &&
    /^\d{4}-\d{2}-\d{2}$/.test(date),
  );
  const slots = availability?.date === date ? availability.slots : [];
  const slot = slots.find((item) => item.id === slotId);
  const stage =
    storedStage === "review" && review?.input.serviceKey !== service
      ? "editing"
      : storedStage;
  const available = Boolean(options?.enabled && services.length);
  const slotsLoading =
    available &&
    validDate &&
    availability?.date !== date &&
    availabilityError !== date;

  useEffect(() => {
    const controller = new AbortController();
    loadOptions(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setOptions(value);
          setOptionsError(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setOptionsError(true);
      });
    return () => controller.abort();
  }, [optionsReload]);

  useEffect(() => {
    if (!options?.enabled || !validDate) return;
    const controller = new AbortController();
    loadSlots(date, options.timezone, controller.signal)
      .then((items) => {
        if (!controller.signal.aborted) {
          setAvailability({ date, slots: items });
          setAvailabilityError(null);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setAvailabilityError(date);
      });
    return () => controller.abort();
  }, [date, options, validDate, slotsReload]);

  useEffect(() => {
    if (stage === "review" || stage === "uncertain" || stage === "saved")
      result.current?.focus();
  }, [stage]);
  useEffect(() => {
    if (stage !== "sending" && stage !== "uncertain") return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [stage]);

  function retryOptions() {
    setOptions(null);
    setOptionsError(false);
    setOptionsReload((value) => value + 1);
    setReview(null);
    setSlotId("");
    setAvailability(null);
  }
  function refreshSlots() {
    setSlotId("");
    setAvailability(null);
    setAvailabilityError(null);
    setSlotsReload((value) => value + 1);
  }
  function resetReview() {
    if (locked) return;
    setReview(null);
    setStage("editing");
    setError("");
    setFieldErrors({});
    attempt.current = null;
  }
  function focusField(name: string) {
    requestAnimationFrame(() => {
      const target =
        name === "service"
          ? form.current?.querySelector('[role="combobox"]')
          : form.current?.querySelector(`[name="${name}"]`);
      if (target instanceof HTMLElement) target.focus();
    });
  }
  function showReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked || !options || !available || !slot) return;
    const data = new FormData(event.currentTarget);
    if (data.get("consent") !== "on") {
      setFieldErrors({ consent: fieldMessages.consent });
      focusField("consent");
      return;
    }
    const value = (name: string) => String(data.get(name) ?? "").trim();
    const invalid = [
      "make",
      "model",
      "name",
      ...(service === "unknown" ? ["problem"] : []),
    ].find((name) => value(name).length < (name === "name" ? 2 : 1));
    if (invalid) {
      setFieldErrors({ [invalid]: fieldMessages[invalid] });
      focusField(invalid);
      return;
    }
    const input: BookingInput = {
      slotId: slot.id,
      make: value("make"),
      model: value("model"),
      name: value("name"),
      phone: value("phone"),
      telegramUsername: value("telegram"),
      serviceKey: service,
      problem: value("problem"),
      consent: { accepted: true, version: options.consent.version },
    };
    setReview({
      input,
      service: services.find((item) => item.id === service)!.title,
      slot,
      timezone: options.timezone,
    });
    setError("");
    setStage("review");
  }
  async function send() {
    if (
      inFlight.current ||
      !review ||
      (stage !== "review" && stage !== "uncertain")
    )
      return;
    inFlight.current = true;
    setStage("sending");
    setError("");
    try {
      attempt.current ??= { key: submissionKey(), input: review.input };
      const saved = await submitBooking(
        attempt.current.input,
        attempt.current.key,
      );
      setReceipt(saved);
      setStage("saved");
      attempt.current = null;
    } catch (failure) {
      if (
        !(failure instanceof ApiError) ||
        failure.status >= 500 ||
        failure.status === 408 ||
        failure.status === 429
      ) {
        setStage("uncertain");
      } else {
        attempt.current = null;
        setStage("editing");
        setReview(null);
        if (failure.code === "SLOT_UNAVAILABLE") {
          refreshSlots();
          setError(
            "Это окно уже заняли или закрыли. Данные сохранены — выберите другое время.",
          );
        } else if (failure.code === "CONSENT_CHANGED") {
          retryOptions();
          setError(
            "Условия обработки данных обновились. Ознакомьтесь с ними и дайте согласие ещё раз.",
          );
        } else if (failure.code === "BOOKING_DISABLED") {
          retryOptions();
          setError("Онлайн-запись сейчас закрыта. Данные остались в форме.");
        } else if (failure.code === "INVALID_INPUT" && failure.field) {
          const name =
            (
              {
                serviceKey: "service",
                slotId: "time",
                telegramUsername: "telegram",
                "consent.version": "consent",
              } as Record<string, string>
            )[failure.field] ?? failure.field;
          if (fieldMessages[name]) {
            setFieldErrors({ [name]: fieldMessages[name] });
            focusField(name);
          } else setError("Проверьте данные заявки и попробуйте ещё раз.");
        } else
          setError(
            failure.code === "ORIGIN_NOT_ALLOWED"
              ? "Отправка недоступна из-за настроек сайта. Попробуйте позже."
              : "Не удалось отправить заявку. Проверьте данные и попробуйте ещё раз.",
          );
      }
    } finally {
      inFlight.current = false;
    }
  }
  const fieldError = (name: string) =>
    fieldErrors[name] ? (
      <span id={`${name}-error`} className={styles.fieldError}>
        {fieldErrors[name]}
      </span>
    ) : null;
  const fallback = siteContent.phone ? (
    <a href={`tel:${siteContent.phone}`}>Позвонить в сервис</a>
  ) : (
    <span>
      Сервис свяжется с вами по указанному телефону после получения заявки.
    </span>
  );

  return (
    <form
      ref={form}
      className={styles.form}
      onSubmit={showReview}
      onChange={resetReview}
      aria-busy={stage === "sending"}
      onInvalidCapture={(event) => {
        const input = event.target;
        if (
          input instanceof HTMLInputElement ||
          input instanceof HTMLTextAreaElement ||
          input instanceof HTMLSelectElement
        ) {
          const name = input.name;
          setFieldErrors((current) => ({
            ...current,
            [name]: fieldMessages[name] ?? "Проверьте это поле.",
          }));
        }
      }}
    >
      <div className={styles.notice} role="status">
        <Icon name="shield" />
        <div>
          {optionsError ? (
            <>
              <p>
                <strong>Не удалось подключиться к записи.</strong> Попробуйте
                ещё раз — введённые данные сохранятся.
              </p>
              <button
                type="button"
                className={styles.retry}
                onClick={retryOptions}
              >
                Повторить загрузку
              </button>
            </>
          ) : !options ? (
            <p>Подключаем расписание…</p>
          ) : !options.enabled ? (
            <p>
              <strong>Онлайн-запись пока закрыта.</strong> Приём заявок появится
              после настройки расписания и документов сервиса.
            </p>
          ) : !services.length ? (
            <p>
              <strong>Услуги ещё не опубликованы.</strong> Онлайн-запись станет
              доступна после настройки сервиса.
            </p>
          ) : (
            <p>
              <strong>Предварительная запись.</strong> Администратор проверит
              заявку и подтвердит время приёма.
            </p>
          )}
        </div>
      </div>
      <fieldset className={styles.fields} disabled={locked}>
        <legend className={styles.srOnly}>Данные заявки</legend>
        <fieldset>
          <legend>
            <span>01</span> О машине
          </legend>
          <div className={styles.grid}>
            <label>
              Марка автомобиля <span>*</span>
              <input
                name="make"
                placeholder="Например, Volkswagen"
                autoComplete="off"
                required
                maxLength={60}
                aria-invalid={Boolean(fieldErrors.make)}
                aria-describedby={fieldErrors.make ? "make-error" : undefined}
              />
              {fieldError("make")}
            </label>
            <label>
              Модель <span>*</span>
              <input
                name="model"
                placeholder="Например, Golf"
                autoComplete="off"
                required
                maxLength={80}
                aria-invalid={Boolean(fieldErrors.model)}
                aria-describedby={fieldErrors.model ? "model-error" : undefined}
              />
              {fieldError("model")}
            </label>
            <ServiceDropdown
              value={service}
              items={services}
              disabled={!available || locked}
              error={fieldErrors.service}
              onChange={(value) => {
                resetReview();
                router.replace(
                  `?service=${encodeURIComponent(value)}#booking`,
                  { scroll: false },
                );
              }}
            />
            <label className={styles.full}>
              Описание задачи {service === "unknown" && <span>*</span>}
              <textarea
                name="problem"
                placeholder="Что беспокоит? Когда появился звук или загорелась ошибка?"
                rows={4}
                maxLength={2000}
                required={service === "unknown"}
                aria-invalid={Boolean(fieldErrors.problem)}
                aria-describedby={
                  fieldErrors.problem ? "problem-error" : undefined
                }
              />
              {fieldError("problem")}
            </label>
          </div>
        </fieldset>
        <fieldset>
          <legend>
            <span>02</span> Удобное время
          </legend>
          <div className={styles.grid}>
            <label className={styles.full}>
              Желаемая дата <span>*</span>
              <input
                name="date"
                type="date"
                required
                value={date}
                min={bounds?.min}
                max={bounds?.max}
                disabled={!available}
                onChange={(event) => {
                  setDate(event.target.value);
                  setSlotId("");
                }}
                aria-invalid={Boolean(fieldErrors.date)}
                aria-describedby={`slots-note${fieldErrors.date ? " date-error" : ""}`}
              />
              {fieldError("date")}
            </label>
            <fieldset
              className={`${styles.timeGroup} ${styles.full}`}
              aria-busy={slotsLoading}
            >
              <legend>
                Время приёма <span>*</span>
              </legend>
              <div aria-live="polite" className={styles.slotState}>
                {!date ? (
                  <p>Выберите дату, чтобы увидеть свободные окна.</p>
                ) : !validDate ? (
                  <p>Выберите дату в пределах расписания.</p>
                ) : slotsLoading ? (
                  <p>Ищем свободные окна…</p>
                ) : availabilityError === date ? (
                  <>
                    <p>Не удалось загрузить расписание.</p>
                    <button
                      type="button"
                      className={styles.retry}
                      onClick={refreshSlots}
                    >
                      Повторить загрузку окон
                    </button>
                  </>
                ) : available && slots.length === 0 ? (
                  <>
                    <p>На эту дату свободных окон нет.</p>
                    <button
                      type="button"
                      className={styles.retry}
                      onClick={() => focusField("date")}
                    >
                      Выбрать другую дату
                    </button>
                    {bounds && date < bounds.max && (
                      <button
                        type="button"
                        className={styles.retry}
                        onClick={() => {
                          const next = new Date(`${date}T12:00:00Z`);
                          next.setUTCDate(next.getUTCDate() + 1);
                          setDate(next.toISOString().slice(0, 10));
                          setSlotId("");
                        }}
                      >
                        Следующий день
                      </button>
                    )}
                  </>
                ) : null}
              </div>
              <div className={styles.times}>
                {slots.map((item) => (
                  <label key={item.id}>
                    <input
                      name="time"
                      type="radio"
                      value={item.id}
                      checked={slotId === item.id}
                      onChange={() => setSlotId(item.id)}
                      required
                      aria-describedby={`slots-note${fieldErrors.time ? " time-error" : ""}`}
                    />
                    <span>
                      {new Intl.DateTimeFormat("ru", {
                        timeZone: options!.timezone,
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(new Date(item.start))}
                    </span>
                  </label>
                ))}
              </div>
              {fieldError("time")}
            </fieldset>
          </div>
          <p id="slots-note" className={styles.hint}>
            {options
              ? `Время указано для сервиса: ${options.timezone}. Окно резервируется после отправки заявки.`
              : "Показываем только окна из расписания сервиса."}
          </p>
          <div className={styles.intakeNote}>
            <Icon name="calendar" />
            <p>
              <strong>Время приёма автомобиля</strong>Выбранное окно нужно для
              передачи машины и обсуждения задачи. Срок ремонта согласуем
              отдельно.
            </p>
          </div>
        </fieldset>
        <fieldset className={styles.contacts}>
          <legend>
            <span>03</span> Как с вами связаться
          </legend>
          <div className={`${styles.grid} ${styles.contactGrid}`}>
            <label>
              Ваше имя <span>*</span>
              <input
                name="name"
                placeholder="Как к вам обращаться"
                autoComplete="given-name"
                required
                minLength={2}
                maxLength={80}
                aria-invalid={Boolean(fieldErrors.name)}
                aria-describedby={fieldErrors.name ? "name-error" : undefined}
              />
              {fieldError("name")}
            </label>
            <label>
              Телефон (+7) <span>*</span>
              <input
                name="phone"
                type="tel"
                placeholder="+7 (___) ___-__-__"
                autoComplete="tel"
                inputMode="tel"
                required
                maxLength={18}
                pattern={"\\+7 \\([3489][0-9]{2}\\) [0-9]{3}-[0-9]{2}-[0-9]{2}"}
                title="Введите номер полностью: +7 (999) 123-45-67"
                onChange={maskPhone}
                onKeyDown={skipPhoneSeparators}
                aria-invalid={Boolean(fieldErrors.phone)}
                aria-describedby={`phone-note${fieldErrors.phone ? " phone-error" : ""}`}
              />
              <span id="phone-note" className={styles.fieldHint}>
                Для согласования записи.
              </span>
              {fieldError("phone")}
            </label>
            <label>
              Telegram <small>необязательно</small>
              <input
                name="telegram"
                placeholder="@username"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={33}
                pattern="@?[A-Za-z0-9_]{1,32}"
                title="Имя пользователя: латинские буквы, цифры и подчёркивание"
                onBlur={(event) => {
                  const value = event.currentTarget.value
                    .trim()
                    .replace(/^@/, "");
                  event.currentTarget.value = value ? `@${value}` : "";
                }}
                aria-invalid={Boolean(fieldErrors.telegram)}
                aria-describedby={`telegram-note${fieldErrors.telegram ? " telegram-error" : ""}`}
              />
              <span id="telegram-note" className={styles.fieldHint}>
                Для связи в Telegram. Тег не подключает уведомления бота.
              </span>
              {fieldError("telegram")}
            </label>
          </div>
        </fieldset>
        {available && options && (
          <div className={styles.consent} key={options.consent.version}>
            <label>
              <input
                name="consent"
                type="checkbox"
                required
                aria-describedby={
                  fieldErrors.consent ? "consent-error" : undefined
                }
              />
              <span>
                Я согласен на обработку данных для записи в сервис и ознакомился
                с{" "}
                <a
                  href={options.consent.noticeUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  условиями обработки данных
                </a>
                .
              </span>
            </label>
            {fieldError("consent")}
          </div>
        )}
      </fieldset>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {stage === "editing" && (
        <div className={styles.actions}>
          <button
            type="submit"
            className="button"
            disabled={!available || !slot}
          >
            Проверить заявку <Icon name="arrow" />
          </button>
          <span>
            Сначала проверьте детали.
            <br />
            Отправка — на следующем шаге.
          </span>
        </div>
      )}
      {review && stage !== "editing" && (
        <section
          ref={result}
          className={styles.preview}
          tabIndex={-1}
          role={
            stage === "saved" || stage === "uncertain" ? "status" : "region"
          }
          aria-label={
            stage === "saved"
              ? "Заявка сохранена"
              : stage === "uncertain"
                ? "Проверка отправки"
                : "Проверьте заявку"
          }
        >
          {stage === "saved" && receipt ? (
            <>
              <strong className={styles.resultTitle}>Заявка сохранена</strong>
              <p className={styles.reference}>
                Номер заявки: {receipt.reference}
              </p>
              <p>{displaySlot(receipt.slot, receipt.timezone)}</p>
              <p>
                Это предварительная запись. Дождитесь подтверждения
                администратора перед визитом.
              </p>
              <p className={styles.hint}>{fallback}</p>
              {receipt.telegramLink ? (
                <>
                  <a
                    className="button"
                    href={receipt.telegramLink}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Получать уведомления в Telegram
                  </a>
                  <p className={styles.hint}>
                    Откройте бота и нажмите Start. Ссылка действует 24 часа; не
                    пересылайте её. Без подключения бота администратор свяжется
                    по телефону.
                  </p>
                </>
              ) : (
                <p className={styles.hint}>
                  Уведомления в Telegram пока не подключены.
                </p>
              )}
            </>
          ) : (
            <>
              <strong className={styles.resultTitle}>
                {stage === "uncertain"
                  ? "Проверим, сохранилась ли заявка"
                  : "Всё верно?"}
              </strong>
              <dl className={styles.summary}>
                <div>
                  <dt>Автомобиль</dt>
                  <dd>
                    {review.input.make} {review.input.model}
                  </dd>
                </div>
                <div>
                  <dt>Задача</dt>
                  <dd>
                    {review.service}
                    {review.input.problem && ` · ${review.input.problem}`}
                  </dd>
                </div>
                <div>
                  <dt>Время приёма</dt>
                  <dd>{displaySlot(review.slot, review.timezone)}</dd>
                </div>
                <div>
                  <dt>Контакт</dt>
                  <dd>
                    {review.input.name} · {review.input.phone}
                    {review.input.telegramUsername &&
                      ` · ${review.input.telegramUsername}`}
                  </dd>
                </div>
              </dl>
              {stage === "uncertain" ? (
                <p className={styles.hint}>
                  Не удалось получить ответ. Заявка могла сохраниться. Повторная
                  проверка с теми же данными не создаст вторую запись. Оставьте
                  страницу открытой.
                </p>
              ) : (
                <p className={styles.hint}>
                  Отправим предварительную заявку. Время подтвердит
                  администратор.
                </p>
              )}
              <div className={styles.actions}>
                <button
                  type="button"
                  className="button"
                  disabled={stage === "sending"}
                  onClick={send}
                >
                  {stage === "sending"
                    ? "Отправляем…"
                    : stage === "uncertain"
                      ? "Проверить заявку ещё раз"
                      : "Отправить заявку"}
                  <Icon name="arrow" />
                </button>
                {stage === "review" && (
                  <button
                    type="button"
                    className={styles.retry}
                    onClick={() => {
                      resetReview();
                      focusField("make");
                    }}
                  >
                    Изменить данные
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      )}
    </form>
  );
}
