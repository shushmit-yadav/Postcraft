import { spawn } from 'node:child_process';
import { AppError } from '../lib/errors.js';

/**
 * Runs FFmpeg with a fixed argument array (never a shell string, so no
 * injection), reports progress from `-progress pipe:1`, and is killed when
 * the signal aborts (step timeout, cancel or worker shutdown).
 */
export function runFfmpeg(
  args: string[],
  opts: { signal: AbortSignal; totalSeconds?: number; onProgress?: (fraction: number) => void },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-progress', 'pipe:1', '-nostats', ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      signal: opts.signal,
      killSignal: 'SIGKILL',
    });

    let stderrTail = '';
    child.stderr.on('data', (d: Buffer) => {
      stderrTail = (stderrTail + d.toString()).slice(-4000);
    });

    let lastReported = 0;
    child.stdout.on('data', (d: Buffer) => {
      if (!opts.totalSeconds || !opts.onProgress) return;
      const m = /out_time_us=(\d+)/.exec(d.toString().split('\n').reverse().join('\n'));
      if (!m) return;
      const fraction = Math.min(1, Number(m[1]) / 1e6 / opts.totalSeconds);
      if (fraction - lastReported >= 0.05) {
        lastReported = fraction;
        opts.onProgress(fraction);
      }
    });

    child.on('error', (err) => {
      if (opts.signal.aborted) return reject(opts.signal.reason);
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return reject(new AppError('FFMPEG_MISSING', 'The video renderer is not available on the server.', { status: 500, cause: err }));
      }
      reject(err);
    });
    child.on('close', (code, signal) => {
      if (opts.signal.aborted) return reject(opts.signal.reason);
      if (code === 0) return resolve();
      // Killed by the OS (e.g. out of memory) is worth a retry; a non-zero exit usually is not.
      reject(
        new AppError('RENDER_FAILED', 'Rendering the video failed.', {
          retryable: signal !== null,
          status: 500,
          internalMessage: `ffmpeg exited code=${code} signal=${signal}: ${stderrTail.split('\n').slice(-12).join('\n')}`,
        }),
      );
    });
  });
}

export interface ProbeResult {
  codec: string | null;
  width: number | null;
  height: number | null;
  pixFmt: string | null;
  fps: number | null;
  durationSec: number | null;
  hasAudio: boolean;
}

export function probe(path: string, signal?: AbortSignal): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,pix_fmt,r_frame_rate:format=duration', '-of', 'json', path],
      { stdio: ['ignore', 'pipe', 'pipe'], signal },
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d));
    child.stderr.on('data', (d: Buffer) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new AppError('PROBE_FAILED', 'Could not read the media file.', { internalMessage: err }));
      const json = JSON.parse(out) as {
        streams?: { codec_type: string; codec_name?: string; width?: number; height?: number; pix_fmt?: string; r_frame_rate?: string }[];
        format?: { duration?: string };
      };
      const v = json.streams?.find((s) => s.codec_type === 'video');
      const [num, den] = (v?.r_frame_rate ?? '').split('/').map(Number);
      resolve({
        codec: v?.codec_name ?? null,
        width: v?.width ?? null,
        height: v?.height ?? null,
        pixFmt: v?.pix_fmt ?? null,
        fps: num && den ? num / den : null,
        durationSec: json.format?.duration ? Number(json.format.duration) : null,
        hasAudio: !!json.streams?.some((s) => s.codec_type === 'audio'),
      });
    });
  });
}
