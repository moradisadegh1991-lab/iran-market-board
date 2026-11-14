import BotView from '@/components/views/BotView';
export const metadata = { title: 'مرکز ربات‌ها' };
export default function Page() {
  return <BotView botUsername={process.env.NEXT_PUBLIC_BOT_USERNAME ?? ''} />;
}
