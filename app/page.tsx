import Dashboard from '@/components/Dashboard';
import { getSnapshot } from '@/lib/snapshot';
import type { Snapshot } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export default async function Page() {
  let initial: Snapshot | null = null;
  try {
    initial = await getSnapshot();
  } catch {
    initial = null;
  }
  return <Dashboard initial={initial} botUsername={process.env.NEXT_PUBLIC_BOT_USERNAME ?? ''} />;
}
