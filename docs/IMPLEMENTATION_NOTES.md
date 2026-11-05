# Implementation notes

Status as of 2026-11-04. Read alongside the [README](../README.md) and [DESIGN_AND_PLAN.md](DESIGN_AND_PLAN.md).

## What is real and what is simulated

| Capability | Status | Notes |
|---|---|---|
| Product URL fetch and parsing | **Real** | JSON-LD → microdata → OpenGraph → HTML. Tested on a Shopify store (beardbrand.com) and scrape-friendly demo shops |
| SSRF protection | **Real** | DNS-time IP checks, redirects re-validated, size and time limits. Unit tested, and tried against metadata IPs, `nip.io` names, IPv4-mapped IPv6 and decimal IPs |
| Image download and validation | **Real** | Magic-byte sniffing, 300px minimum, decompression-bomb limit, re-encode |
| Product analysis and script/caption | **Real with Claude, simulated without a key** | With `ANTHROPIC_API_KEY` set: `ClaudeProvider` (`claude-opus-5-5`) analyzes up to 3 product images with vision, then writes the script as structured JSON, validated against `ScriptSchema`. Unit-tested against a stubbed client; **not yet run against the live API** (no key was available while building). Without a key: `MockProvider` builds the copy deterministically from the product text. The UI badge says which one ran |
| Video rendering (MP4) | **Real** | sharp + FFmpeg. Text inside platform safe zones, crossfades, H.264/AAC, faststart |
| Image rendering (PNG) | **Real** | Same layout engine, exact format size |
| Format verification | **Real** | Every output is checked with ffprobe/sharp (size, codec, pixel format, duration) before the job completes |
| Queue, persistence, retries, crash recovery | **Real** | Postgres + pg-boss. Tested by killing the worker with `kill -9` mid-render; the job resumed at the render step |
| Storage | **Real, local disk** | Behind a `StorageProvider` interface; an S3/R2 adapter is not written |
| Image upload | **Real** | `POST /api/uploads`: 15 MB cap, magic bytes, 300px minimum, re-encode, owned by the session. The user adds the product name and optional features |
| Video upload | **Not built** | |
| Script review/edit before render | **Partly built** | The runner can pause at `awaiting_review`; the API routes and UI to edit and resume are not built |
| Voiceover | **Real, offline** | Optional per job (video formats). FFmpeg's built-in `flite` voice reads the hook, scenes and CTA; each scene stretches to fit its line. No key or network needed. The voice sounds robotic |
| Background music | **Not built** | Videos without voiceover carry a silent AAC track (platforms expect an audio stream) |
| Hosted deployment | **Not built** | Deferred (ADR-002). The Docker image and Compose stack are what would ship |

**Decision for this submission:** the demo and the default setup use the mock provider, with no API key. The brief allows a simulated generation flow; everything except the copywriting is real. The Claude provider is in the code and switches on by adding `ANTHROPIC_API_KEY` to `.env`.

## Known issues

- **The offline voice sounds robotic.** `flite` is a classic synthesizer chosen because it ships inside FFmpeg (no key, no download). Voiced videos run 1–2s longer because scenes stretch to fit speech.

- **Live Claude calls are untested.** The provider's request shape, output validation and error mapping are covered by tests with a stubbed client; the first real run needs an API key.
- **Generic copy from the mock.** Pages without short description sentences get generic scene lines ("Built for every day"), and category guessing is keyword-based ("product" when unsure). A real model is the fix.
- **Many large stores block the scraper** with 403/429 (bot protection). That is intentional (ADR-003): the app reports `SITE_BLOCKED`, does not get around the block, and points the user to image upload.
- **Text width is estimated, not measured.** The layout uses an average glyph width for DejaVu Sans Bold. Text with many wide letters can come out slightly wider than planned; panels have padding to absorb it. Emoji and non-Latin scripts are not supported in the rendered overlays (captions may still contain emoji).
- **A small product card when captions are long.** Text zones take priority over the card, so a video with 3-line captions gets a smaller product image. Long text never overlaps the product (covered by a test).
- **Generated files are never deleted.** There is no retention job yet.
- **Rate limits are in memory, per API process.** Correct for one instance; multiple instances would need a shared store.
- **Anonymous sessions.** Jobs belong to a browser cookie (30 days). Clearing cookies or switching browsers loses access to past jobs.
- **Crash recovery takes ~35s.** This is the pg-boss heartbeat window (15s) plus its supervisor interval (10s) plus a retry delay. The UI shows the step as still running during that time.
- **Render time:** a 13s 1080×1920 video takes about 13–28s on a laptop CPU, depending on load.
- **Not tested:** graceful worker shutdown on SIGTERM (it is implemented). The render step is covered by an integration test in CI; the full pipeline with the database and queue was tested by hand (dev setup and Docker stack).
- **No ESLint yet.** CI (GitHub Actions) runs `tsc`, Vitest and the production build on every push.

## Trade-offs I made

| Decision | Alternative | Why |
|---|---|---|
| pg-boss on Postgres | BullMQ + Redis | One less service. The job row and its queue entry commit in one transaction, so a job can never exist without being queued. Throughput is far beyond what this needs |
| Polling every 1.5s | Server-Sent Events | Works behind any proxy and is simple to reason about. SSE is an upgrade, not a fix |
| FFmpeg + sharp | Remotion (React video) | Faster renders, lighter image, no licensing questions. Costs some layout convenience |
| Text laid out in SVG, rasterized by sharp | FFmpeg `drawtext` | Real wrapping, auto-shrink, rounded panels. `drawtext` can't do these well |
| One image, API and worker as two processes | Separate services | Same code and dependencies; scale the worker independently by running more of it |
| Gradient background from the photo's dominant color | Blurred photo fill | Most product photos have white backgrounds, which blur into flat grey |
| Honest bot user agent | Spoofing a browser | Avoids the legal/ethical risk and an arms race; upload is the reliable path (ADR-003) |
| Mock provider when no key is set | Requiring an API key | Anyone can clone and run it; the demo can't fail because of an outside service |
| Fail and retry when Claude is down | Silently falling back to the mock | Generic copy presented as AI output would mislead; a visible retry/failure is honest |
| Two Claude calls (analyze with vision, then script) | One combined call | Each step keeps its own checkpoint, so a failed script call doesn't redo the image analysis |
| Anonymous sessions | Accounts | Zero-friction review. Accounts are on the roadmap |

## What I would improve next (in order)

1. **Review step UI:** edit hook, scenes and CTA, then render. The pause already exists in the runner.
2. **Retention job** that deletes files and rows after 7 days.
3. **Video upload:** trim, reframe to 9:16, burn in captions.

## How the product could evolve

- **Brand kits** (logo, colors, fonts) applied to every template: the biggest jump in perceived quality.
- **Variants:** three hooks/templates per job, then learn which perform best.
- **A natural voice and word-timed captions:** swap the offline `flite` voice for Piper (local neural TTS) or a hosted voice, and time captions to the words, since most short-form video is watched muted.
- **Richer templates with Remotion:** describe scenes as React components (animated text, transitions, brand layouts) instead of hand-built FFmpeg filter graphs. It still encodes with FFmpeg, so the format checks stay the same.
- **AI-generated footage and AI voiceover on top of the current pipeline:** an AI video model (e.g. Runway, Veo) for short generated clips, and text-to-speech reading the script. Both become extra inputs to the same render and verify steps; FFmpeg stays responsible for exact sizes, durations and encoding.
- **Official data sources** (Shopify Storefront API, merchant product feeds) in place of scraping.
- **Accounts, history and teams**, then scheduling and direct publishing through platform APIs.
- **Scale:** S3/R2 storage, a separate render worker pool, per-job cost tracking, caching scrape and model results by URL.
