import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Circle,
  Copy,
  Loader2,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import { FORMATS, JOB_STEPS, STEP_PROGRESS, isTerminal, type JobStep, type JobView } from '@app/shared';
import { api, ApiError } from '../lib/api';
import { Button, Card, SectionTitle } from '../components/ui';
import { Preview } from '../components/Preview';

const STEP_LABELS: Record<JobStep, string> = {
  ingesting: 'Fetching product',
  analyzing: 'Analyzing',
  scripting: 'Writing script',
  rendering: 'Rendering',
  finalizing: 'Checking format',
};

export function JobPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();

  const job = useQuery({
    queryKey: ['job', id],
    queryFn: () => api.getJob(id),
    // Poll while the job is running; stop once it reaches a resting state.
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s && (isTerminal(s) || s === 'awaiting_review') ? false : 1500;
    },
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 3,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['job', id] });
  const retry = useMutation({ mutationFn: () => api.retryJob(id), onSuccess: invalidate });
  const cancel = useMutation({ mutationFn: () => api.cancelJob(id), onSuccess: invalidate });

  if (job.isPending) {
    return <Loader2 className="mx-auto mt-24 h-6 w-6 animate-spin text-slate-400" />;
  }
  if (job.isError) {
    return (
      <Card className="text-center">
        <p className="text-slate-700">
          {job.error instanceof ApiError && job.error.status === 404
            ? 'This job does not exist or belongs to another browser session.'
            : job.error.message}
        </p>
        <Link to="/" className="mt-3 inline-block text-brand-700 underline">
          Create new content
        </Link>
      </Card>
    );
  }

  const j = job.data;
  const format = FORMATS[j.formatId];
  const running = !isTerminal(j.status) && j.status !== 'awaiting_review';

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      <div className="grid content-start gap-5">
        <Card>
          <div className="mb-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-lg font-semibold">
                {format.label} · {format.width}×{format.height}
              </h1>
              {j.inputUrl && <p className="truncate text-sm text-slate-500">{j.inputUrl}</p>}
            </div>
            <StatusBadge status={j.status} />
          </div>
          <ProgressBar value={j.progress} status={j.status} />
          <StepTimeline job={j} />

          {j.error && (
            <div role="alert" className="mt-4 flex gap-3 rounded-lg bg-red-50 p-4 text-sm text-red-800">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <div>
                <p className="font-medium">{j.error.message}</p>
                <p className="mt-0.5 text-xs text-red-700/80">Error code: {j.error.code}</p>
              </div>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            {(j.status === 'failed' || j.status === 'cancelled') && (
              <Button onClick={() => retry.mutate()} loading={retry.isPending}>
                <RotateCcw className="h-4 w-4" /> Retry from last step
              </Button>
            )}
            {running && (
              <Button variant="secondary" onClick={() => cancel.mutate()} loading={cancel.isPending}>
                <XCircle className="h-4 w-4" /> Cancel
              </Button>
            )}
            <Link
              to="/"
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium ${
                isTerminal(j.status)
                  ? 'bg-brand-600 text-white hover:bg-brand-700'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <ArrowLeft className="h-4 w-4" />
              {isTerminal(j.status) ? 'Create another post' : 'Back to create'}
            </Link>
          </div>
        </Card>

        {j.outputs.length > 0 && <Outputs job={j} />}
        {j.script && <ScriptCard job={j} />}
      </div>

      <Card className="content-start">
        <SectionTitle>Activity</SectionTitle>
        <ol className="space-y-2 text-sm">
          {j.events.map((e) => (
            <li key={e.id} className="flex gap-2">
              <span className="shrink-0 tabular-nums text-xs leading-5 text-slate-400">
                {new Date(e.createdAt).toLocaleTimeString()}
              </span>
              <span
                className={
                  e.level === 'error' ? 'text-red-700' : e.level === 'warn' ? 'text-amber-700' : 'text-slate-700'
                }
              >
                {e.message}
              </span>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}

function StatusBadge({ status }: { status: JobView['status'] }) {
  const styles: Record<string, string> = {
    completed: 'bg-emerald-100 text-emerald-800',
    failed: 'bg-red-100 text-red-800',
    cancelled: 'bg-slate-200 text-slate-700',
    awaiting_review: 'bg-amber-100 text-amber-800',
  };
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium capitalize ${styles[status] ?? 'bg-brand-100 text-brand-700'}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

function ProgressBar({ value, status }: { value: number; status: JobView['status'] }) {
  const color = status === 'failed' ? 'bg-red-500' : status === 'completed' ? 'bg-emerald-500' : 'bg-brand-600';
  return (
    <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full transition-all duration-500 ${color}`} style={{ width: `${value}%` }} />
    </div>
  );
}

type StepState = 'done' | 'active' | 'failed' | 'pending';

function StepTimeline({ job }: { job: JobView }) {
  // The first unfinished step is where a failed job stopped.
  const firstUnfinished = JOB_STEPS.find((s) => job.progress < STEP_PROGRESS[s][1]);

  const stateOf = (step: JobStep): StepState => {
    if (job.status === 'completed' || job.progress >= STEP_PROGRESS[step][1]) return 'done';
    if (job.status === step) return 'active';
    if (job.status === 'failed' && step === firstUnfinished) return 'failed';
    return 'pending';
  };

  return (
    <ol className="mt-4 grid grid-cols-5 gap-2 text-xs">
      {JOB_STEPS.map((step) => {
        const state = stateOf(step);
        return (
          <li key={step} className="flex flex-col items-center gap-1 text-center">
            {state === 'done' && <CheckCircle2 className="h-5 w-5 text-emerald-500" />}
            {state === 'active' && <Loader2 className="h-5 w-5 animate-spin text-brand-600" />}
            {state === 'failed' && <XCircle className="h-5 w-5 text-red-500" />}
            {state === 'pending' && <Circle className="h-5 w-5 text-slate-300" />}
            <span className={state === 'pending' ? 'text-slate-400' : 'text-slate-700'}>{STEP_LABELS[step]}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Outputs({ job }: { job: JobView }) {
  const format = FORMATS[job.formatId];
  const main = job.outputs.find((o) => o.kind === 'output_video' || o.kind === 'output_image');
  const poster = job.outputs.find((o) => o.kind === 'thumbnail');
  if (!main) return null;
  return (
    <Card>
      <SectionTitle>Result</SectionTitle>
      <Preview format={format} output={main} poster={poster} />
    </Card>
  );
}

function ScriptCard({ job }: { job: JobView }) {
  const s = job.script!;
  const captionText = `${s.caption}\n\n${s.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ')}`;
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <SectionTitle>Script & caption</SectionTitle>
        {job.provider && (
          <span className="text-xs text-slate-500">Written by {job.provider === 'claude' ? 'Claude' : 'mock provider (simulated)'}</span>
        )}
      </div>
      <dl className="grid gap-3 text-sm">
        <div>
          <dt className="text-xs uppercase text-slate-500">Hook</dt>
          <dd className="font-medium">{s.hook}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-slate-500">Scenes</dt>
          <dd>
            <ol className="list-decimal pl-5">
              {s.scenes.map((sc, i) => (
                <li key={i}>
                  {sc.text} <span className="text-slate-400">({sc.durationSec}s)</span>
                </li>
              ))}
            </ol>
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-slate-500">Call to action</dt>
          <dd>{s.cta}</dd>
        </div>
        <div>
          <dt className="flex items-center justify-between text-xs uppercase text-slate-500">
            Caption <CopyButton text={captionText} />
          </dt>
          <dd className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3">{captionText}</dd>
        </div>
      </dl>
    </Card>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 normal-case text-brand-700"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      <Copy className="h-3.5 w-3.5" /> {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
