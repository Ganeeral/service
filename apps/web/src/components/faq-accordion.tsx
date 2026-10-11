"use client";

import { useId, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import styles from "./faq-accordion.module.css";

export function FaqAccordion({
  items,
}: {
  items: readonly { question: string; answer: string }[];
}) {
  const id = useId();
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const reduceMotion = useReducedMotion();

  return (
    <div className={styles.items}>
      {items.map((item, index) => {
        const isOpen = openIndex === index;
        const buttonId = `${id}-question-${index}`;
        const panelId = `${id}-answer-${index}`;
        const transition = {
          duration: reduceMotion ? 0 : 0.3,
          ease: "easeInOut" as const,
        };

        return (
          <div className={styles.item} key={item.question}>
            <h3>
              <button
                type="button"
                id={buttonId}
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setOpenIndex(isOpen ? null : index)}
              >
                {item.question}
                <motion.span
                  aria-hidden="true"
                  initial={false}
                  animate={{ rotate: isOpen ? 45 : 0 }}
                  transition={transition}
                  className={styles.toggle}
                >
                  +
                </motion.span>
              </button>
            </h3>
            <motion.div
              id={panelId}
              role="region"
              aria-labelledby={buttonId}
              aria-hidden={!isOpen}
              inert={!isOpen}
              className={styles.answer}
              initial={false}
              animate={{ height: isOpen ? "auto" : 0, opacity: isOpen ? 1 : 0 }}
              transition={transition}
            >
              <p>{item.answer}</p>
            </motion.div>
          </div>
        );
      })}
    </div>
  );
}
