import { Link, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Sparkles } from 'lucide-react';
import { api } from '../lib/api';

export function Layout() {
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, refetchInterval: 15_000 });

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <img src="/favicon.svg" alt="" className="h-7 w-7" />
            Postcraft
          </Link>
          {health.data && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600"
              title="Which content provider writes the scripts"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {health.data.contentProvider === 'claude' ? 'AI: Claude' : 'AI: Mock (simulated)'}
            </span>
          )}
        </div>
      </header>

      {health.isError && (
        <Banner>Can't reach the backend. Start it with <code>npm run dev</code>.</Banner>
      )}
      {health.data && health.data.workers === 0 && (
        <Banner>No worker is running, so jobs will wait in the queue until one starts.</Banner>
      )}

      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b border-amber-200 bg-amber-50 text-amber-900">
      <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-2 text-sm">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>{children}</span>
      </div>
    </div>
  );
}
