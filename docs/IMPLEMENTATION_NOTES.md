# Implementation notes

Status as of 2026-11-04. Read alongside the [README](../README.md) and [DESIGN_AND_PLAN.md](DESIGN_AND_PLAN.md).

## What is real and what is simulated

| Capability | Status | Notes |
|---|---|---|
| Product URL fetch and parsing | **Real** | JSON-LD → microdata → OpenGraph → HTML. Tested on a Shopify store (beardbrand.com) and scrape-friendly demo shops |
| SSRF protection | **Real** | DNS-time IP checks, redirects re-validated, size and time limits. Unit tested, and tried against metadata IPs, `nip.io` names, IPv4-mapped IPv6 and decimal IPs |
| Image download and validation | **Real** | Magic-byte sniffing, 300px minimum, decompression-bomb limit, re-encode |
| Product analysis and script/caption | **Simulated** | `MockProvider` builds hook, scenes, CTA, caption and hashtags deterministically from the scraped text and the chosen tone. No model is called. The UI labels it "Mock (simulated)" |
| Video rendering (MP4) | **Real** | sharp + FFmpeg. Text inside platform safe zones, crossfades, H.264/AAC, faststart |
| Image rendering (PNG) | **Real** | Same layout engine, exact format size |
| Format verification | **Real** | Every output is checked with ffprobe/sharp (size, codec, pixel format, duration) before the job completes |
| Queue, persistence, retries, crash recovery | **Real** | Postgres + pg-boss. Tested by killing the worker with `kill -9` mid-render; the job resumed at the render step |
| Storage | **Real, local disk** | Behind a `StorageProvider` interface; an S3/R2 adapter is not written |
| Image / video upload | **Not built** | Planned next. It is also the fallback when a store blocks scraping |
| Script review/edit before render | **Partly built** | The runner can pause at `awaiting_review`; the API routes and UI to edit and resume are not built |
| Music / voiceover | **Not built** | Videos have a silent AAC track (platforms expect an audio stream) |
| Hosted deployment | **Not built** | Deferred (ADR-002). The Docker image and Compose stack are what would ship |

## Known issues

- **Generic copy from the mock.** Pages without short description sentences get generic scene lines ("Built for every day"), and category guessing is keyword-based ("product" when unsure). A real model is the fix.
- **Many large stores block the scraper** with 403/429 (bot protection). That is intentional (ADR-003): the app reports `SITE_BLOCKED` and does not get around the block. Until upload exists, those products can't be used.
- **Text width is estimated, not measured.** The layout uses an average glyph width for DejaVu Sans Bold. Text with many wide letters can come out slightly wider than planned; panels have padding to absorb it. Emoji and non-Latin scripts are not supported in the rendered overlays (captions may still contain emoji).
- **A small product card when captions are long.** Text zones take priority over the card, so a video with 3-line captions gets a smaller product image. Long text never overlaps the product (covered by a test).
- **Generated files are never deleted.** There is no retention job yet.
- **Rate limits are in memory, per API process.** Correct for one instance; multiple instances would need a shared store.
- **Anonymous sessions.** Jobs belong to a browser cookie (30 days). Clearing cookies or switching browsers loses access to past jobs.
- **Crash recovery takes ~35s.** This is the pg-boss heartbeat window (15s) plus its supervisor interval (10s) plus a retry delay. The UI shows the step as still running during that time.
- **Render time:** a 13s 1080×1920 video takes about 13–28s on a laptop CPU, depending on load.
- **Not tested:** graceful worker shutdown on SIGTERM (it is implemented); a full pipeline integration test in CI (the pipeline was tested by hand, through both the dev setup and the Docker stack).
- **No CI and no ESLint yet.** Checks are Vitest + `tsc`.

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
| Mock provider as the default | Requiring an API key | Anyone can clone and run it; the demo can't fail because of an outside service |
| Anonymous sessions | Accounts | Zero-friction review. Accounts are on the roadmap |

## What I would improve next (in order)

1. **Image upload.** Streamed multipart, the same validation as scraped images, feeding the existing pipeline from the analyze step. It covers every store that blocks scraping.
2. **Claude content provider** (vision + structured JSON validated by the existing `ScriptSchema`), with the mock kept as the fallback when the key is missing or the API is down.
3. **Review step UI:** edit hook, scenes and CTA, then render. The pause already exists in the runner.
4. **Pipeline integration test + CI:** render a fixture image for each format and assert the ffprobe output, on every push.
5. **Retention job** that deletes files and rows after 7 days.
6. **Video upload:** trim, reframe to 9:16, burn in captions.

## How the product could evolve

- **Brand kits** (logo, colors, fonts) applied to every template: the biggest jump in perceived quality.
- **Variants:** three hooks/templates per job, then learn which perform best.
- **Voiceover and word-timed captions**, since most short-form video is watched muted with captions.
- **Official data sources** (Shopify Storefront API, merchant product feeds) in place of scraping.
- **Accounts, history and teams**, then scheduling and direct publishing through platform APIs.
- **Scale:** S3/R2 storage, a separate render worker pool, per-job cost tracking, caching scrape and model results by URL.
