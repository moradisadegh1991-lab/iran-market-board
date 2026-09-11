import { Suspense } from 'react';
import ChartsView from '@/components/views/ChartsView';
export const metadata = { title: 'نمودار' };
export default function Page() {
  return (
    <Suspense fallback={<div className="wrap"><div className="chart-host skeleton" /></div>}>
      <ChartsView />
    </Suspense>
  );
}
