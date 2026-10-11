import Link from "next/link";
import { notFound } from "next/navigation";

export default function BookingTestNotice() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className="container" style={{ paddingBlock: 80, maxWidth: 760 }}>
      <h1>Условия тестовой записи</h1>
      <p>
        Эта страница предназначена только для проверки разработки на
        изолированной тестовой базе. Используйте вымышленные данные. Записи
        сохраняются для проверки формы и удаляются после теста.
      </p>
      <p>
        Это не политика обработки данных сервиса и не согласие для реальных
        клиентов. Рабочие документы будут опубликованы после согласования с
        владельцем.
      </p>
      <Link href="/#booking">Вернуться к форме</Link>
    </main>
  );
}
