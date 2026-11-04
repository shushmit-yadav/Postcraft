import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-500/50',
  secondary: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 disabled:opacity-50',
  ghost: 'text-slate-600 hover:bg-slate-100 disabled:opacity-50',
};

export function Button({
  variant = 'primary',
  loading,
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      {children}
    </section>
  );
}

export function SectionTitle({ step, children }: { step?: number; children: ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
      {step !== undefined && (
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-100 text-xs text-brand-700">
          {step}
        </span>
      )}
      {children}
    </h2>
  );
}

/** A box drawn at the format's aspect ratio, so users see the output shape. */
export function AspectBox({ ratio, active }: { ratio: string; active?: boolean }) {
  const [w, h] = ratio.split(':').map(Number) as [number, number];
  const scale = 28 / Math.max(w, h);
  return (
    <span
      aria-hidden
      className={`inline-block rounded-[3px] border-2 ${active ? 'border-brand-600 bg-brand-100' : 'border-slate-400'}`}
      style={{ width: w * scale, height: h * scale }}
    />
  );
}
