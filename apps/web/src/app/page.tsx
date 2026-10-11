import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { BookingForm } from "@/components/booking-form";
import { FaqAccordion } from "@/components/faq-accordion";
import { Header } from "@/components/header";
import { Icon } from "@/components/icon";
import { siteContent } from "@/lib/site-content";
import styles from "./page.module.css";

const benefits = [
  {
    icon: "chat",
    title: "Понятный разговор",
    text: "Опишите задачу своими словами",
  },
  {
    icon: "car",
    title: "Внимание к машине",
    text: "Марка, модель и детали обращения",
  },
  {
    icon: "calendar",
    title: "Удобная запись",
    text: "Приём в согласованное время",
  },
  {
    icon: "shield",
    title: "Прозрачный процесс",
    text: "Предварительная заявка и подтверждение",
  },
] as const;

export default function HomePage() {
  return (
    <>
      <a className="skip-link" href="#main">
        Перейти к содержимому
      </a>
      <div id="top" className={styles.prototypeBar}>
        Сайт в разработке <span /> Казань · Контакты и график пока для примера
      </div>
      <Header />
      <main id="main">
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroPhoto}>
            <Image
              src="/images/workshop-illustration.webp"
              alt="Визуальная иллюстрация мастерской с автомобилем, не фотография реального сервиса"
              fill
              priority
              sizes="(max-width: 767px) 100vw, 75vw"
            />
          </div>
          <div className={`container ${styles.heroInner}`}>
            <div className={styles.heroCopy}>
              <h1 id="hero-title">
                Больше,
                <br />
                чем просто
                <br />
                <span>ремонт.</span>
              </h1>
              <p className={styles.heroDescription}>
                Забота о машине начинается с внимания.
                <br />
                Расскажите, что нужно вашему автомобилю.
              </p>
              <div className={styles.heroActions}>
                <a className="button" href="#booking">
                  Записаться в сервис <Icon name="arrow" />
                </a>
                <a className={styles.secondaryLink} href="#services">
                  Посмотреть услуги <Icon name="arrow" />
                </a>
              </div>
              <div className={styles.heroNote}>
                <span /> Обслуживание. Диагностика. Ремонт.
              </div>
            </div>
          </div>
          <span className={styles.heroVertical}>У Илюхи / Автосервис</span>
        </section>

        <section
          className={`container ${styles.benefits}`}
          aria-label="Как устроено обращение"
        >
          {benefits.map((benefit) => (
            <div key={benefit.title} className={styles.benefit}>
              <Icon name={benefit.icon} />
              <div>
                <h2>{benefit.title}</h2>
                <p>{benefit.text}</p>
              </div>
            </div>
          ))}
        </section>

        <section
          id="services"
          className={`container ${styles.section}`}
          aria-labelledby="services-title"
        >
          <div className={styles.sectionHeading}>
            <div>
              <h2 id="services-title" className="section-title">
                Наши услуги
              </h2>
            </div>
            <Link href="?service=unknown#booking" className={styles.textLink}>
              Не знаете, что выбрать? <Icon name="arrow" />
            </Link>
          </div>
          <div className={styles.services}>
            {siteContent.services.map((service, index) => (
              <Link
                key={service.id}
                href={`?service=${service.id}#booking`}
                className={styles.serviceCard}
                aria-label={`${service.title} — перейти к форме записи`}
              >
                <div className={styles.servicePhoto}>
                  <div
                    className={styles.serviceSheet}
                    style={{
                      left: `${(index % 3) * -100}%`,
                      transform: `translateY(-${index < 3 ? 25 : 75}%)`,
                    }}
                  >
                    <Image
                      src="/images/service-illustrations.webp"
                      alt=""
                      fill
                      sizes="(max-width: 600px) 280vw, (max-width: 1000px) 140vw, 100vw"
                    />
                  </div>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                </div>
                <div className={styles.serviceContent}>
                  <div>
                    <h3>{service.title}</h3>
                    <p>{service.description}</p>
                  </div>
                  <span className={styles.cardArrow}>
                    <Icon name="arrow" />
                  </span>
                </div>
              </Link>
            ))}
          </div>
          <p className={styles.contentNote}>
            Предварительный список услуг и иллюстрации. Направления работ
            подтвердит владелец сервиса.
          </p>
        </section>

        <section
          id="about"
          className={styles.about}
          aria-labelledby="about-title"
        >
          <div className={`container ${styles.aboutInner}`}>
            <div>
              <h2 id="about-title" className="section-title">
                Сначала разобраться.
                <br />
                <span>Потом ремонтировать.</span>
              </h2>
            </div>
            <div>
              <p className={styles.aboutText}>
                Не нужно разбираться в устройстве машины, чтобы обратиться в
                сервис. Начнём с того, что вы заметили.
              </p>
              <ul className={styles.aboutPoints}>
                <li>
                  <Icon name="chat" />
                  <div>
                    <strong>Расскажите о симптомах</strong>
                    <p>
                      Когда появился звук, загорелась ошибка или изменилось
                      поведение машины.
                    </p>
                  </div>
                </li>
                <li>
                  <Icon name="calendar" />
                  <div>
                    <strong>Выберите время для приёма</strong>
                    <p>
                      В заявке оставьте контакты — администратор уточнит детали
                      и подтвердит визит.
                    </p>
                  </div>
                </li>
              </ul>
              <a href="#booking" className={styles.lightLink}>
                Обсудить задачу <Icon name="arrow" />
              </a>
            </div>
          </div>
        </section>

        <section
          id="process"
          className={`container ${styles.section}`}
          aria-labelledby="process-title"
        >
          <div className={styles.sectionHeading}>
            <div>
              <h2 id="process-title" className="section-title">
                От заявки — к приёму
              </h2>
            </div>
            <p className={styles.sectionSideNote}>
              Запись предварительная
              <br />
              до подтверждения времени
            </p>
          </div>
          <ol className={styles.steps}>
            {[
              {
                title: "Расскажите о машине",
                text: "Укажите автомобиль, задачу и удобное окно для приёма.",
              },
              {
                title: "Получите подтверждение",
                text: "Администратор уточнит детали и согласует время по указанным контактам.",
              },
              {
                title: "Приезжайте в сервис",
                text: "В согласованное время. Объём, стоимость и срок работ обсудите отдельно.",
              },
            ].map((step, index) => (
              <li key={step.title}>
                <span className={styles.stepNumber}>0{index + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section
          id="booking"
          className={styles.booking}
          aria-labelledby="booking-title"
        >
          <div className={`container ${styles.bookingInner}`}>
            <div className={styles.bookingHeading}>
              <div>
                <h2 id="booking-title" className="section-title">
                  Запись в сервис
                </h2>
                <p>Расскажите о машине и выберите время для приёма.</p>
              </div>
              <div className={styles.bookingConfirmation}>
                <Icon name="chat" />
                <p>
                  <strong>Время подтвердит администратор</strong>
                  Оставьте контакты, чтобы уточнить детали обращения.
                </p>
              </div>
            </div>
            <Suspense
              fallback={
                <div className={styles.formFallback}>Загружаем форму…</div>
              }
            >
              <BookingForm />
            </Suspense>
          </div>
        </section>

        <section
          className={`container ${styles.consultation}`}
          aria-labelledby="consultation-title"
        >
          <div>
            <h2 id="consultation-title" className="section-title">
              Стучит? Горит ошибка?
              <br />
              Просто расскажите.
            </h2>
            <p>
              Выберите диагностику и опишите симптомы.
              <br />
              Начнём с того, что уже известно.
            </p>
            <Link className="button" href="?service=unknown#booking">
              Нужна диагностика <Icon name="arrow" />
            </Link>
          </div>
          <div className={styles.consultationGraphic} aria-hidden="true">
            <div />
            <Icon name="wrench" />
            <span>Понятный первый шаг</span>
          </div>
        </section>

        <section
          id="faq"
          className={`container ${styles.faq}`}
          aria-labelledby="faq-title"
        >
          <div>
            <h2 id="faq-title" className="section-title">
              Есть вопросы?
              <br />
              Это нормально.
            </h2>
            <p>О записи и первом обращении.</p>
          </div>
          <FaqAccordion items={siteContent.faqs} />
        </section>

        <section
          id="contacts"
          className={styles.contacts}
          aria-labelledby="contacts-title"
        >
          <div className={`container ${styles.contactsInner}`}>
            <div>
              <h2 id="contacts-title" className="section-title">
                Мы на связи
              </h2>
              <p>
                {siteContent.demoContacts
                  ? "Мы в Казани. Адрес, телефон и график ниже — примеры для макета. Заменим их перед запуском."
                  : "Свяжитесь с нами перед визитом."}
              </p>
            </div>
            <dl className={styles.contactList}>
              <div>
                <dt>
                  <Icon name="pin" /> Адрес сервиса
                </dt>
                <dd>{siteContent.address ?? "Скоро добавим точный адрес"}</dd>
              </div>
              <div>
                <dt>
                  <Icon name="clock" /> График работы
                </dt>
                <dd>{siteContent.hours ?? "Уточняется у владельца"}</dd>
              </div>
              <div>
                <dt>
                  <Icon name="phone" /> Телефон и Telegram
                </dt>
                <dd>
                  {siteContent.phone ?? siteContent.demoPhone}
                  {siteContent.telegramUrl && (
                    <>
                      <br />
                      <a
                        href={siteContent.telegramUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        @ilyxa_service_bot
                      </a>
                    </>
                  )}
                </dd>
              </div>
            </dl>
          </div>
        </section>
      </main>
      <footer className={styles.footer}>
        <div className={`container ${styles.footerInner}`}>
          <a href="#top" className={styles.footerBrand}>
            У Илюхи<span>Автосервис</span>
          </a>
          <p>
            Сайт в разработке · Условия сервиса уточняются.
            <br />
            Изображения созданы для концепции; это не фотографии реальной
            мастерской.
          </p>
          <a href="#top" className={styles.backToTop}>
            Наверх <span>↑</span>
          </a>
        </div>
      </footer>
    </>
  );
}
