import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const manrope = localFont({
  src: "../../public/fonts/manrope.ttf",
  variable: "--font-body",
  display: "swap",
  weight: "200 800",
});
const oswald = localFont({
  src: "../../public/fonts/oswald.ttf",
  variable: "--font-heading",
  display: "swap",
  weight: "200 700",
});

export const metadata: Metadata = {
  title: "У Илюхи — автосервис в Казани | Прототип",
  description:
    "Обслуживание и ремонт автомобиля в Казани. Прототип сайта автосервиса «У Илюхи» с формой предварительной записи.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" className={`${manrope.variable} ${oswald.variable}`}>
      <body>{children}</body>
    </html>
  );
}
