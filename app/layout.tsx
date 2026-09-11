import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/vazirmatn';
import '@fontsource/lalezar/arabic-400.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'تابلوی بازار — طلا، ارز، کریپتو و بورس',
  description: 'قیمت لحظه‌ای، ریسک خرید و فروش، غربال کریپتو و بورس، و سبد پیشنهادی',
};

export const viewport: Viewport = { themeColor: '#1C2C52', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
