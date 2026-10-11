"use client";

import { useRef, useState } from "react";
import { Icon } from "./icon";
import styles from "./header.module.css";

const links = [
  { href: "#services", label: "Услуги" },
  { href: "#about", label: "О сервисе" },
  { href: "#process", label: "Как записаться" },
  { href: "#faq", label: "Вопросы" },
  { href: "#contacts", label: "Контакты" },
];

export function Header() {
  const [isOpen, setIsOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);

  return (
    <header
      className={styles.header}
      onKeyDown={(event) => {
        if (event.key === "Escape" && isOpen) {
          setIsOpen(false);
          menuButton.current?.focus();
        }
      }}
    >
      <div className={`container ${styles.inner}`}>
        <a
          className={styles.brand}
          href="#top"
          aria-label="У Илюхи — на главную"
        >
          У Илюхи<span>Автосервис</span>
        </a>
        <nav className={styles.desktopNav} aria-label="Основная навигация">
          {links.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
        <a className={`button ${styles.bookingLink}`} href="#booking">
          Записаться <Icon name="arrow" />
        </a>
        <button
          ref={menuButton}
          className={styles.menuButton}
          type="button"
          aria-label={isOpen ? "Закрыть меню" : "Открыть меню"}
          aria-expanded={isOpen}
          aria-controls="mobile-navigation"
          onClick={() => setIsOpen(!isOpen)}
        >
          <span className={isOpen ? styles.open : undefined} />
          <span className={isOpen ? styles.open : undefined} />
        </button>
      </div>
      <nav
        id="mobile-navigation"
        hidden={!isOpen}
        className={styles.mobileNav}
        aria-label="Мобильная навигация"
      >
        {links.map((link) => (
          <a key={link.href} href={link.href} onClick={() => setIsOpen(false)}>
            {link.label}
            <Icon name="arrow" />
          </a>
        ))}
        <a href="#booking" onClick={() => setIsOpen(false)}>
          Записаться
          <Icon name="calendar" />
        </a>
      </nav>
    </header>
  );
}
