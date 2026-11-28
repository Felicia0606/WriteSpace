import { lazy, Suspense, type ComponentProps } from 'react';

const Dialog = lazy(() => import('./PeerReviewDialog').then((module) => ({ default: module.PeerReviewDialog })));

// Keep the Supabase client out of the initial writing and teacher workspace bundles.
export function PeerReviewDialog(props: ComponentProps<typeof Dialog>) {
  return <Suspense fallback={
    <div role="status" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
      <div className="rounded-3xl bg-white p-6 text-sm font-bold text-slate-600">Opening peer feedback…</div>
    </div>
  }><Dialog {...props} /></Suspense>;
}
