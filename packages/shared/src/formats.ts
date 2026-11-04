/**
 * Platform format registry: the single source of truth for output rules.
 *
 * The UI builds its platform/format pickers from this, and the worker reads
 * dimensions, durations and safe zones from it. Adding a platform format is a
 * config change, not a code change.
 *
 * Durations are product defaults (what performs for short-form product content
 * and keeps renders fast), not platform maximums. Safe-zone values approximate
 * where each app draws its own UI (captions, buttons) over the content.
 */

export const PLATFORMS = ['instagram', 'tiktok', 'youtube'] as const;
export type Platform = (typeof PLATFORMS)[number];

export interface SafeZone {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

interface BaseFormat {
  id: string;
  platform: Platform;
  label: string;
  description: string;
  width: number;
  height: number;
  aspectRatio: string;
  safeZone: SafeZone;
}

export interface VideoFormat extends BaseFormat {
  kind: 'video';
  fps: number;
  targetSeconds: number;
  maxSeconds: number;
}

export interface ImageFormat extends BaseFormat {
  kind: 'image';
}

export type OutputFormat = VideoFormat | ImageFormat;

const NO_SAFE_ZONE: SafeZone = { top: 0, bottom: 0, left: 0, right: 0 };

export const FORMATS = {
  ig_reel: {
    id: 'ig_reel',
    platform: 'instagram',
    kind: 'video',
    label: 'Reel',
    description: 'Vertical short video for the Reels feed',
    width: 1080,
    height: 1920,
    aspectRatio: '9:16',
    fps: 30,
    targetSeconds: 15,
    maxSeconds: 60,
    safeZone: { top: 220, bottom: 420, left: 60, right: 120 },
  },
  ig_feed: {
    id: 'ig_feed',
    platform: 'instagram',
    kind: 'image',
    label: 'Feed post',
    description: 'Portrait image post (4:5)',
    width: 1080,
    height: 1350,
    aspectRatio: '4:5',
    safeZone: { top: 60, bottom: 60, left: 60, right: 60 },
  },
  ig_story: {
    id: 'ig_story',
    platform: 'instagram',
    kind: 'video',
    label: 'Story',
    description: 'Full-screen vertical story video',
    width: 1080,
    height: 1920,
    aspectRatio: '9:16',
    fps: 30,
    targetSeconds: 12,
    maxSeconds: 60,
    safeZone: { top: 250, bottom: 340, left: 60, right: 60 },
  },
  tt_video: {
    id: 'tt_video',
    platform: 'tiktok',
    kind: 'video',
    label: 'TikTok video',
    description: 'Vertical short video for the For You feed',
    width: 1080,
    height: 1920,
    aspectRatio: '9:16',
    fps: 30,
    targetSeconds: 15,
    maxSeconds: 60,
    safeZone: { top: 160, bottom: 480, left: 60, right: 160 },
  },
  yt_short: {
    id: 'yt_short',
    platform: 'youtube',
    kind: 'video',
    label: 'Short',
    description: 'Vertical YouTube Short',
    width: 1080,
    height: 1920,
    aspectRatio: '9:16',
    fps: 30,
    targetSeconds: 15,
    maxSeconds: 60,
    safeZone: { top: 200, bottom: 420, left: 60, right: 140 },
  },
  yt_thumb: {
    id: 'yt_thumb',
    platform: 'youtube',
    kind: 'image',
    label: 'Thumbnail',
    description: 'Landscape video thumbnail (16:9)',
    width: 1280,
    height: 720,
    aspectRatio: '16:9',
    safeZone: { ...NO_SAFE_ZONE, bottom: 80, right: 160 }, // timestamp badge, bottom-right
  },
} as const satisfies Record<string, OutputFormat>;

export type FormatId = keyof typeof FORMATS;
export const FORMAT_IDS = Object.keys(FORMATS) as [FormatId, ...FormatId[]];

export function getFormat(id: FormatId): OutputFormat {
  return FORMATS[id];
}

export function formatsForPlatform(platform: Platform): OutputFormat[] {
  return Object.values(FORMATS).filter((f) => f.platform === platform);
}

/** The area where it is safe to place text so platform UI won't cover it. */
export function contentBox(format: OutputFormat) {
  const { width, height, safeZone: s } = format;
  return {
    x: s.left,
    y: s.top,
    width: width - s.left - s.right,
    height: height - s.top - s.bottom,
  };
}
