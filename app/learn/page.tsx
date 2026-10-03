import { Suspense } from 'react';
import LearnView from '@/components/learn/LearnView';
export const metadata = { title: 'آموزش مالی' };
export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="wrap">
          <p className="muted state">در حال بارگذاری…</p>
        </div>
      }
    >
      <LearnView />
    </Suspense>
  );
}
