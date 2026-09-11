import BotView from '@/components/views/BotView';
export const metadata = { title: 'ربات و منابع' };
export default function Page() {
  return <BotView botUsername={process.env.NEXT_PUBLIC_BOT_USERNAME ?? ''} />;
}
