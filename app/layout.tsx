import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/vazirmatn';
import '@fontsource/lalezar/arabic-400.css';
import './globals.css';
import SnapshotProvider from '@/components/SnapshotProvider';
import Shell from '@/components/Shell';
import { getSnapshot } from '@/lib/snapshot';
import type { Snapshot } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const metadata: Metadata = {
  title: { default: 'تابلوی بازار: طلا، ارز، کریپتو و بورس', template: '%s | تابلوی بازار' },
  description: 'قیمت لحظه‌ای، سناریوی بدترین و بهترین حالت، ریسک، نمودار، غربال بورس و کریپتو و سبد پیشنهادی',
};

export const viewport: Viewport = { themeColor: '#1A2848', width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let initial: Snapshot | null = null;
  try {
    initial = await getSnapshot();
  } catch {
    initial = null;
  }
  return (
    <html lang="fa" dir="rtl">
      <body>
        <SnapshotProvider initial={initial}>
          <Shell>{children}</Shell>
        </SnapshotProvider>
      </body>
    </html>
  );
}
