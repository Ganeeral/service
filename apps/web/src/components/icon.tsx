import type { CSSProperties } from "react";

const paths = {
  arrow: "M5 12h14M13 6l6 6-6 6",
  wrench:
    "M14.7 6.3a5 5 0 0 0-6.5 6.5L3 18a2.1 2.1 0 0 0 3 3l5.2-5.2a5 5 0 0 0 6.5-6.5l-3 3-3-3 3-3Z",
  check: "m5 12 4 4L19 6",
  shield: "M12 3 4 6v6c0 4.5 8 9 8 9s8-4.5 8-9V6l-8-3Zm-4 9 3 3 5-6",
  chat: "M4 4h16v12H9l-5 4V4Zm4 5h8M8 12h5",
  calendar: "M5 5h14v15H5V5Zm3-3v6m8-6v6M5 10h14m-10 4h2m2 0h2",
  pin: "M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0ZM12 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3 2",
  phone:
    "m7 3 3 5-3 3c2 3 3 4 6 6l3-3 5 3c0 3-2 5-5 4C9 19 5 15 3 8 2 5 4 3 7 3Z",
  car: "m5 9 2-5h10l2 5M3 9h18v8H3V9Zm2 8v3m14-3v3M6 13h2m8 0h2",
} as const;

export function Icon({
  name,
  className,
  style,
}: {
  name: keyof typeof paths;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
    >
      <path d={paths[name]} />
    </svg>
  );
}
