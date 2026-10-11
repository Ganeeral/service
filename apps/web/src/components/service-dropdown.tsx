"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Icon } from "./icon";
import styles from "./service-dropdown.module.css";

export function ServiceDropdown({
  value,
  onChange,
  items,
  disabled = false,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  items: readonly { id: string; title: string; description: string }[];
  disabled?: boolean;
  error?: string;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const options = useRef<HTMLDivElement>(null);
  const search = useRef({ text: "", at: 0 });
  const [isOpen, setIsOpen] = useState(false);
  const [opensUp, setOpensUp] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [hasError, setHasError] = useState(false);
  const reduceMotion = useReducedMotion();
  const selectedIndex = items.findIndex((option) => option.id === value);
  const selected = items[selectedIndex];
  const transition = {
    duration: reduceMotion ? 0 : 0.2,
    ease: "easeOut" as const,
  };

  function open(index = Math.max(0, selectedIndex)) {
    if (disabled || !items.length) return;
    const bounds = trigger.current?.getBoundingClientRect();
    if (bounds) {
      const below = window.innerHeight - bounds.bottom - 12;
      setOpensUp(below < 320 && bounds.top - 110 > below);
    }
    search.current = { text: "", at: 0 };
    setActiveIndex(index);
    setIsOpen(true);
  }

  function choose(index: number) {
    setIsOpen(false);
    setHasError(false);
    if (items[index]) onChange(items[index].id);
  }

  useEffect(() => {
    if (!isOpen) return;
    function outside(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !root.current?.contains(event.target)
      ) {
        setIsOpen(false);
      }
    }
    function close() {
      setIsOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", close);
    };
  }, [isOpen]);

  useEffect(() => {
    const list = options.current;
    const option = list?.children[activeIndex];
    if (!isOpen || !list || !(option instanceof HTMLElement)) return;
    const top = option.offsetTop;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + option.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = top + option.offsetHeight - list.clientHeight;
    }
  }, [isOpen, activeIndex]);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled || !items.length) return;
    const { key } = event;
    if (key === "Tab") {
      if (isOpen) choose(activeIndex);
      return;
    }
    if (key === "Escape") {
      if (isOpen) event.preventDefault();
      setIsOpen(false);
      return;
    }
    if (["Enter", " ", "ArrowDown", "ArrowUp", "Home", "End"].includes(key)) {
      event.preventDefault();
      if (key === "Enter" || key === " ") {
        if (isOpen) choose(activeIndex);
        else open();
      } else if (key === "Home" || key === "End") {
        const next = key === "Home" ? 0 : items.length - 1;
        if (isOpen) setActiveIndex(next);
        else open(next);
      } else if (!isOpen) open();
      else
        setActiveIndex((index) =>
          Math.max(
            0,
            Math.min(items.length - 1, index + (key === "ArrowDown" ? 1 : -1)),
          ),
        );
      return;
    }
    if (key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey)
      return;
    event.preventDefault();
    const now = performance.now();
    const letter = key.toLocaleLowerCase("ru");
    const previous = now - search.current.at < 600 ? search.current.text : "";
    const text = previous === letter ? letter : previous + letter;
    const start =
      text.length === 1
        ? (isOpen && !disabled ? activeIndex : selectedIndex) + 1
        : 0;
    const indices = items.map((_, index) => (start + index) % items.length);
    const match = indices.find((index) =>
      items[index].title.toLocaleLowerCase("ru").startsWith(text),
    );
    if (!isOpen) open(match ?? Math.max(0, selectedIndex));
    else if (match !== undefined) setActiveIndex(match);
    search.current = { text, at: now };
  }

  return (
    <div className={styles.root} ref={root}>
      <label
        id={`${id}-label`}
        htmlFor={`${id}-trigger`}
        className={styles.label}
      >
        Что нужно сделать? <span>*</span>
      </label>
      <div className={styles.control}>
        <button
          id={`${id}-trigger`}
          ref={trigger}
          type="button"
          disabled={disabled || !items.length}
          role="combobox"
          className={styles.trigger}
          aria-labelledby={`${id}-label ${id}-value`}
          aria-haspopup="listbox"
          aria-controls={`${id}-list`}
          aria-expanded={isOpen && !disabled}
          aria-required="true"
          aria-invalid={Boolean(error || (hasError && !value))}
          aria-describedby={
            error || (hasError && !value) ? `${id}-error` : undefined
          }
          aria-activedescendant={
            isOpen && !disabled ? `${id}-option-${activeIndex}` : undefined
          }
          onClick={() => (isOpen && !disabled ? setIsOpen(false) : open())}
          onKeyDown={handleKeyDown}
          onBlur={() => setIsOpen(false)}
        >
          <Icon name="wrench" />
          <span
            id={`${id}-value`}
            className={selected ? styles.value : styles.placeholder}
          >
            {selected?.title ?? "Выберите услугу"}
          </span>
          <motion.svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={styles.chevron}
            initial={false}
            animate={{ rotate: isOpen && !disabled ? 180 : 0 }}
            transition={transition}
          >
            <path d="m6 9 6 6 6-6" />
          </motion.svg>
        </button>
        <select
          name="service"
          className={styles.nativeSelect}
          tabIndex={-1}
          aria-hidden="true"
          value={value}
          disabled={disabled || !items.length}
          required
          onChange={(event) => {
            onChange(event.target.value);
            setHasError(false);
          }}
          onInvalid={(event) => {
            event.preventDefault();
            setHasError(true);
            trigger.current?.focus();
          }}
        >
          <option value="" disabled>
            Выберите услугу
          </option>
          {items.map((option) => (
            <option value={option.id} key={option.id}>
              {option.title}
            </option>
          ))}
        </select>
        <motion.div
          className={styles.panel}
          data-side={opensUp ? "top" : "bottom"}
          initial={false}
          animate={{
            height: isOpen && !disabled ? "auto" : 0,
            opacity: isOpen && !disabled ? 1 : 0,
            y: isOpen && !disabled ? 0 : opensUp ? 5 : -5,
          }}
          transition={transition}
          aria-hidden={!isOpen || disabled}
          inert={!isOpen || disabled}
        >
          <div
            id={`${id}-list`}
            role="listbox"
            aria-labelledby={`${id}-label`}
            className={styles.options}
            ref={options}
          >
            {items.map((option, index) => (
              <button
                id={`${id}-option-${index}`}
                key={option.id}
                type="button"
                role="option"
                tabIndex={-1}
                aria-label={option.title}
                aria-describedby={`${id}-description-${index}`}
                aria-selected={option.id === value}
                data-active={index === activeIndex}
                className={styles.option}
                onPointerDown={(event) => event.preventDefault()}
                onPointerMove={(event) => {
                  if (event.pointerType === "mouse") setActiveIndex(index);
                }}
                onClick={() => choose(index)}
              >
                <span>
                  <strong>{option.title}</strong>
                  <span
                    id={`${id}-description-${index}`}
                    className={styles.description}
                  >
                    {option.description}
                  </span>
                </span>
                {option.id === value && <Icon name="check" />}
              </button>
            ))}
          </div>
        </motion.div>
      </div>
      {(error || (hasError && !value)) && (
        <p id={`${id}-error`} className={styles.error} role="alert">
          {error ?? "Выберите услугу."}
        </p>
      )}
    </div>
  );
}
