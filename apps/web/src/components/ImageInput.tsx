import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ImagePlus, Loader2 } from 'lucide-react';
import { api, ApiError } from '../lib/api';

const ACCEPT = 'image/jpeg,image/png,image/webp,image/avif';
const MAX_BYTES = 15 * 1024 * 1024; // same limit as the server; checked here only to fail fast

/** Picks a product photo, uploads it immediately, and reports the stored asset id. */
export function ImageInput({ onAsset }: { onAsset: (assetId: string | null) => void }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const upload = useMutation({
    mutationFn: api.uploadImage,
    onSuccess: ({ assetId }) => onAsset(assetId),
  });

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  function onFile(file: File | undefined) {
    onAsset(null);
    upload.reset();
    setLocalError(null);
    setPreview(file ? URL.createObjectURL(file) : null);
    if (!file) return;
    if (file.size > MAX_BYTES) return setLocalError('The image is larger than 15 MB.');
    upload.mutate(file);
  }

  const error = localError ?? (upload.error instanceof ApiError ? upload.error.message : upload.error ? 'Upload failed.' : null);

  return (
    <div>
      <label
        htmlFor="image"
        className="flex cursor-pointer items-center gap-4 rounded-xl border-2 border-dashed border-slate-300 p-4 hover:border-brand-500 focus-within:border-brand-600"
      >
        {preview ? (
          <img src={preview} alt="Selected product" className="h-24 w-24 rounded-lg object-cover" />
        ) : (
          <span className="flex h-24 w-24 items-center justify-center rounded-lg bg-slate-100">
            <ImagePlus className="h-8 w-8 text-slate-400" />
          </span>
        )}
        <span className="text-sm">
          <span className="font-medium text-brand-700">{preview ? 'Choose another image' : 'Choose a product photo'}</span>
          <span className="block text-slate-500">JPEG, PNG, WebP or AVIF · at least 300×300 · up to 15 MB</span>
          {upload.isPending && (
            <span className="mt-1 inline-flex items-center gap-1 text-slate-600">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading…
            </span>
          )}
          {upload.isSuccess && (
            <span className="mt-1 block text-emerald-700">
              Uploaded ({upload.data.width}×{upload.data.height})
            </span>
          )}
        </span>
        <input id="image" type="file" accept={ACCEPT} className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
      </label>
      {error && (
        <p role="alert" className="mt-1 text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
