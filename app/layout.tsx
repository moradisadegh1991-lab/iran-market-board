import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/vazirmatn';
import '@fontsource/lalezar/arabic-400.css';
import './globals.css';
import './finance.css';
import SnapshotProvider from '@/components/SnapshotProvider';
import Shell from '@/components/Shell';
import FinanceProvider from '@/components/finance/FinanceProvider';
import NotifyProvider from '@/components/NotifyProvider';
import AppStartup from '@/components/AppStartup';
import { getSnapshot } from '@/lib/snapshot';
import type { Snapshot } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const metadata: Metadata = {
  title: { default: 'مالی من: دخل و خرج، بودجه، وام و مشاور مالی', template: '%s | مالی من' },
  description: 'مدیریت مالی شخصی برای ایرانی‌ها: تراکنش‌ها، بودجه، اقساط و چک، اهداف پس‌انداز، دارایی با قیمت روز طلا و ارز، و مشاور مالی هوشمند',
};

export const viewport: Viewport = { themeColor: '#1A2848', width: 'device-width', initialScale: 1, viewportFit: 'cover' };

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
          <NotifyProvider>
            <FinanceProvider>
              <AppStartup />
              <Shell>{children}</Shell>
            </FinanceProvider>
          </NotifyProvider>
        </SnapshotProvider>
      </body>
    </html>
  );
}
