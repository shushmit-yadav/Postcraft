import { useState } from 'react';
import { Download, Eye, EyeOff } from 'lucide-react';
import type { JobOutput, OutputFormat } from '@app/shared';
import { Button } from './ui';

const formatBytes = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

/**
 * Shows the generated file at its true aspect ratio, with an optional overlay
 * shading the areas the platform's own UI covers (captions, buttons). This makes
 * the format rules visible: all our text should sit inside the clear area.
 */
export function Preview({ format, output, poster }: { format: OutputFormat; output: JobOutput; poster?: JobOutput }) {
  const [showSafe, setShowSafe] = useState(false);
  const z = format.safeZone;
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const portrait = format.height > format.width;

  return (
    <figure className="grid gap-3">
      <div
        className={`relative mx-auto w-full overflow-hidden bg-black shadow-lg ring-1 ring-slate-900/10 ${
          portrait ? 'max-w-[340px] rounded-[2rem] border-[6px] border-slate-900' : 'rounded-xl'
        }`}
        style={{ aspectRatio: `${format.width} / ${format.height}` }}
      >
        {output.mime.startsWith('video/') ? (
          <video
            src={output.url}
            poster={poster?.url}
            controls
            playsInline
            loop
            preload="metadata"
            className="absolute inset-0 h-full w-full object-contain"
          />
        ) : (
          <img src={output.url} alt="Generated post" className="absolute inset-0 h-full w-full object-contain" />
        )}
        {showSafe && (
          <div className="pointer-events-none absolute inset-0" aria-hidden>
            <div className="absolute inset-x-0 top-0 bg-red-500/35" style={{ height: pct(z.top, format.height) }} />
            <div className="absolute inset-x-0 bottom-0 bg-red-500/35" style={{ height: pct(z.bottom, format.height) }} />
            <div className="absolute left-0 bg-red-500/35" style={{ top: pct(z.top, format.height), bottom: pct(z.bottom, format.height), width: pct(z.left, format.width) }} />
            <div className="absolute right-0 bg-red-500/35" style={{ top: pct(z.top, format.height), bottom: pct(z.bottom, format.height), width: pct(z.right, format.width) }} />
          </div>
        )}
      </div>

      <figcaption className="flex flex-wrap items-center justify-center gap-2 text-xs text-slate-500">
        <span>
          {output.width}×{output.height} · {format.aspectRatio} · {output.mime === 'video/mp4' ? 'MP4 (H.264)' : 'PNG'}
          {output.durationMs ? ` · ${(output.durationMs / 1000).toFixed(1)}s` : ''} · {formatBytes(output.bytes)}
        </span>
        <button
          type="button"
          onClick={() => setShowSafe((v) => !v)}
          className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-0.5 text-slate-600 hover:bg-slate-50"
          aria-pressed={showSafe}
        >
          {showSafe ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          {showSafe ? 'Hide' : 'Show'} platform UI zones
        </button>
      </figcaption>

      <a href={output.downloadUrl} download className="mx-auto w-full max-w-[340px]">
        <Button className="w-full">
          <Download className="h-4 w-4" /> Download {output.mime === 'video/mp4' ? 'video' : 'image'}
        </Button>
      </a>
    </figure>
  );
}
