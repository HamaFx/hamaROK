import { Suspense } from 'react';
import CompareScreen from '@/features/compare/compare-screen';
import { SkeletonSet } from '@/components/ui/primitives';

export default function Page() {
  return (
    <Suspense fallback={<div className="space-y-4"><SkeletonSet rows={5} /></div>}>
      <CompareScreen />
    </Suspense>
  );
}
