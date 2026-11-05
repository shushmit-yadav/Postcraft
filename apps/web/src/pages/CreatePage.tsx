import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Image as ImageIcon, Link2, Video, Wand2 } from 'lucide-react';
import {
  FORMATS,
  PLATFORMS,
  formatsForPlatform,
  type FormatId,
  type InputType,
  type Platform,
  type Tone,
} from '@app/shared';
import { api, ApiError } from '../lib/api';
import { AspectBox, Button, Card, SectionTitle } from '../components/ui';
import { ImageInput } from '../components/ImageInput';

const PLATFORM_LABELS: Record<Platform, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
};

const INPUT_TABS: { id: InputType; label: string; icon: typeof Link2; available: boolean }[] = [
  { id: 'url', label: 'Product URL', icon: Link2, available: true },
  { id: 'image', label: 'Image', icon: ImageIcon, available: true },
  { id: 'video', label: 'Video', icon: Video, available: false },
];

const TONES: Tone[] = ['energetic', 'friendly', 'premium', 'playful'];

/** Pages known to allow automated access, for one-click trials (many big stores block bots). */
const EXAMPLE_URLS = [
  { label: 'Beard oil (Shopify store)', url: 'https://www.beardbrand.com/products/tea-tree-beard-oil' },
  { label: 'Book (demo shop)', url: 'https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html' },
];

export function CreatePage() {
  const navigate = useNavigate();
  const [inputType, setInputType] = useState<InputType>('url');
  const [url, setUrl] = useState('');
  const [assetId, setAssetId] = useState<string | null>(null);
  const [productName, setProductName] = useState('');
  const [description, setDescription] = useState('');
  const [platform, setPlatform] = useState<Platform>('instagram');
  const [formatId, setFormatId] = useState<FormatId>('ig_reel');
  const [tone, setTone] = useState<Tone>('energetic');
  // One key per form submission: double clicks or network retries never create two jobs.
  const idempotencyKey = useRef(crypto.randomUUID());

  useQuery({ queryKey: ['formats'], queryFn: api.formats, staleTime: Infinity });
  const platformFormats = useMemo(() => formatsForPlatform(platform), [platform]);

  const create = useMutation({
    mutationFn: () =>
      api.createJob(
        {
          ...(inputType === 'image'
            ? { inputType: 'image' as const, assetId: assetId!, productName: productName.trim(), description: description.trim() || undefined }
            : { inputType: 'url' as const, url: url.trim() }),
          platform,
          formatId,
          options: { tone, reviewBeforeRender: false },
        },
        idempotencyKey.current,
      ),
    onSuccess: ({ jobId }) => {
      idempotencyKey.current = crypto.randomUUID();
      navigate(`/jobs/${jobId}`);
    },
  });

  function selectPlatform(p: Platform) {
    setPlatform(p);
    setFormatId(formatsForPlatform(p)[0]!.id as FormatId);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  const urlError = url && !isHttpUrl(url) ? 'Enter a full link starting with http:// or https://' : null;
  const inputReady =
    inputType === 'url' ? isHttpUrl(url) : inputType === 'image' && !!assetId && productName.trim().length >= 2;
  const canSubmit = inputReady && !create.isPending;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Turn a product into a social post</h1>
        <p className="mt-2 text-slate-600">
          Paste a product link, pick a platform, and get a ready-to-post video or image sized to that
          platform's format rules.
        </p>
      </div>

      <form onSubmit={onSubmit} className="grid gap-5">
        <Card>
          <SectionTitle step={1}>Input</SectionTitle>
          <div role="tablist" className="mb-4 inline-flex rounded-lg bg-slate-100 p-1">
            {INPUT_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={inputType === t.id}
                disabled={!t.available}
                onClick={() => setInputType(t.id)}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm ${
                  inputType === t.id ? 'bg-white font-medium shadow-sm' : 'text-slate-600'
                } disabled:cursor-not-allowed disabled:opacity-50`}
              >
                <t.icon className="h-4 w-4" />
                {t.label}
                {!t.available && <span className="text-[10px] uppercase">soon</span>}
              </button>
            ))}
          </div>

          {inputType === 'image' && (
            <div className="grid gap-3">
              <ImageInput onAsset={setAssetId} />
              <div>
                <label htmlFor="productName" className="mb-1 block text-sm text-slate-700">
                  Product name
                </label>
                <input
                  id="productName"
                  required
                  maxLength={80}
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  placeholder="e.g. Sunrise Ceramic Mug"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100"
                />
              </div>
              <div>
                <label htmlFor="description" className="mb-1 block text-sm text-slate-700">
                  Key features <span className="text-slate-400">(optional, one short sentence each)</span>
                </label>
                <textarea
                  id="description"
                  rows={3}
                  maxLength={600}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Keeps coffee hot for six hours. Dishwasher safe."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100"
                />
              </div>
            </div>
          )}

          {inputType === 'url' && (
            <div>
              <label htmlFor="url" className="mb-1 block text-sm text-slate-700">
                Product page URL
              </label>
              <input
                id="url"
                type="url"
                inputMode="url"
                autoComplete="off"
                placeholder="https://shop.example.com/products/..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                aria-invalid={!!urlError}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100"
              />
              {urlError && <p className="mt-1 text-sm text-red-600">{urlError}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                Try an example:
                {EXAMPLE_URLS.map((e) => (
                  <button
                    key={e.url}
                    type="button"
                    onClick={() => setUrl(e.url)}
                    className="rounded-full border border-slate-200 px-2 py-0.5 text-slate-700 hover:bg-slate-50"
                  >
                    {e.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card>
          <SectionTitle step={2}>Platform & format</SectionTitle>
          <div className="mb-4 grid grid-cols-3 gap-2">
            {PLATFORMS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => selectPlatform(p)}
                aria-pressed={platform === p}
                className={`rounded-xl border px-3 py-3 text-sm font-medium ${
                  platform === p
                    ? 'border-brand-600 bg-brand-50 text-brand-700'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                {PLATFORM_LABELS[p]}
              </button>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {platformFormats.map((f) => (
              <label
                key={f.id}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${
                  formatId === f.id ? 'border-brand-600 bg-brand-50' : 'border-slate-200'
                }`}
              >
                <input
                  type="radio"
                  name="format"
                  value={f.id}
                  checked={formatId === f.id}
                  onChange={() => setFormatId(f.id as FormatId)}
                  className="sr-only"
                />
                <span className="flex h-8 w-8 items-center justify-center">
                  <AspectBox ratio={f.aspectRatio} active={formatId === f.id} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {f.label}{' '}
                    <span className="font-normal text-slate-500">
                      · {f.kind === 'video' ? 'MP4' : 'PNG'} {f.width}×{f.height} ({f.aspectRatio})
                    </span>
                  </span>
                  <span className="block text-xs text-slate-500">
                    {f.description}
                    {f.kind === 'video' && ` · ~${f.targetSeconds}s`}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </Card>

        <Card>
          <SectionTitle step={3}>Style</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {TONES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTone(t)}
                aria-pressed={tone === t}
                className={`rounded-full border px-3 py-1 text-sm capitalize ${
                  tone === t ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-200'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </Card>

        {create.error && (
          <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {create.error instanceof ApiError ? create.error.message : 'Could not start generation.'}
          </p>
        )}

        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">
            Output: {FORMATS[formatId].label} for {PLATFORM_LABELS[platform]}
          </p>
          <Button type="submit" disabled={!canSubmit} loading={create.isPending}>
            <Wand2 className="h-4 w-4" />
            Generate
          </Button>
        </div>
      </form>
    </div>
  );
}

function isHttpUrl(value: string) {
  try {
    const u = new URL(value.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
