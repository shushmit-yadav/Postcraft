# AI Social Content Generator: Design & Execution Plan

> **Revision 2:** simplified after a design review. Redis/BullMQ replaced by pg-boss, API and worker merged into one backend codebase, polling instead of SSE, local storage behind an interface, mock content generator as the default, image upload promoted to P0, deployment deferred (ADR-002). See §16 for what changed and why.

## Implementation status (2026-11-04)

This document is the design and plan. What is actually built today:

| Area | Status |
|---|---|
| URL input → scrape → script → render → verify → preview/download | ✅ Built and tested end to end |
| Image upload input (photo + product name + optional features) | ✅ Built and tested end to end |
| All 6 formats (Reel, Story, TikTok, Short as MP4; Feed post, YouTube thumbnail as PNG) | ✅ Built; every output verified with ffprobe/sharp |
| Job queue, checkpoints, retries, cancel, crash recovery, stalled-job sweeper | ✅ Built and tested (incl. `kill -9` of the worker mid-render) |
| SSRF guard, signed file URLs, session scoping, rate limits | ✅ Built; unit tested |
| Docker image + full `docker compose up` | ✅ Built and tested |
| Content provider | ⚠️ Mock only (simulated). Claude provider not built yet |
| Video upload | ❌ Not built yet |
| Review/edit script before render | ⚠️ Backend pause exists; API routes and UI not built |
| Artifact cleanup after 7 days | ❌ Not built (files are kept) |
| ESLint, GitHub Actions CI, Playwright E2E | ❌ Not built (Vitest + `tsc` only) |
| Hosted deployment | ⏸ Deferred (ADR-002) |

See [IMPLEMENTATION_NOTES.md](IMPLEMENTATION_NOTES.md) for real vs simulated, known issues and next steps.

## 0. How I read the brief

The evaluators say it outright: *"We are not looking for the maximum number of features."* They are grading:

1. **One workflow that is truly finished end to end** (input → generate → status → preview → download).
2. **Async job handling and failures.** Generation is slow and can fail, so this is the core engineering problem.
3. **Fundamentals:** persistence, security (URL fetching and uploads are the two big risks), deployability, code quality.
4. **Product judgment and communication:** clear trade-offs, honest notes on what's real and what's simulated, and a sensible roadmap.

**Strategy:** build a narrow, reliable vertical slice first, with **as few moving parts as possible**. Then widen it cheaply by making platform formats and input types **pluggable**, so each new platform is a config entry and each new input type is one adapter.

---

## 1. Product scope & prioritization

| Priority | Scope | Why |
|---|---|---|
| **P0 (must ship)** | **Product URL → Instagram Reel (9:16 MP4) + caption/hashtags**, with live status, preview, and download | URL is the most "magical" input: no assets are needed from the user. A Reel shows the hard parts (video rendering, format rules) |
| **P0** | **Image upload → same pipeline** | Scraping is the riskiest dependency (many stores block bots). Image upload guarantees a working path, and URL failures can point users to it |
| **P0** | Instagram Feed post (4:5 PNG) from the same job | Almost free once the pipeline exists, and shows multi-format output |
| **P1** | TikTok and YouTube Shorts (9:16), YouTube thumbnail (16:9) | Format registry makes platforms cheap |
| **P1** | **Review step:** user edits the AI-generated script (hook, scene text, CTA) before rendering | Strong product-judgment signal: human in the loop, avoids paying for renders of bad copy |
| **P1** | Video upload input (trim, reframe to 9:16, burn in captions) | Heavier processing, so it comes after the core is solid |
| **P2** | TTS voiceover, background music, multiple visual templates, job history, auth, SSE live updates | Nice to have; list as "next" in the notes |

**Out of scope (stated explicitly):** direct publishing to platforms via their APIs, a full video editor, payments, hosted deployment (for now, see ADR-002).

---

## 2. Architecture

```
 ┌──────────────┐   REST (poll)   ┌──────────────────────┐        ┌──────────────┐
 │  React SPA   │ ──────────────▶ │  API process         │──────▶ │  Postgres    │ jobs, assets, events
 │  (Vite)      │ ◀────────────── │  (Fastify)           │        │  + pg-boss   │ queue tables
 └──────────────┘                 └──────────┬───────────┘        └──────┬───────┘
                                             │ insert job + enqueue      │ claim job
                                             │ (one transaction)         ▼
 ┌──────────────┐                            │                ┌──────────────────────┐   ┌──────────────┐
 │ Storage      │ ◀──────────────────────────┴──────────────── │  Worker process      │──▶│ Content      │
 │ (local disk; │        uploads / outputs                     │  (pipeline, FFmpeg,  │   │ provider:    │
 │  S3 adapter) │                                              │   sharp)             │   │ Mock|Claude  │
 └──────────────┘                                              └──────────────────────┘   └──────────────┘
```

**Key principles**
- **The API never does heavy work.** It validates input, writes the job, enqueues it in the **same Postgres transaction**, and returns `202 + jobId`.
- **Postgres is the only stateful service.** It is the source of truth for job state and also carries the queue (pg-boss), so a job can never be half-created.
- **One backend codebase, two processes.** `server.ts` (API) and `worker.ts` (pipeline) share code, run as separate processes, and scale independently.

### ADR-001: React (Vite) SPA + Fastify instead of Next.js

- **Context:** the product is an interactive tool behind a form. It has no public content pages, so SSR, server components and SEO add nothing. We already need a separate long-running Node worker for FFmpeg.
- **Decision:** a React + Vite SPA for the UI and a standalone Fastify API, sharing Zod schemas with the worker through `packages/shared`.
- **Why:**
  - All backend logic (API + worker) sits in one place.
  - A plain Node server makes long-running jobs and graceful shutdown simple, with no serverless timeouts.
  - The architecture is easy to explain: SPA → API → queue → worker.
  - Builds are fast and the UI is static files.
- **Trade-off:** two frontend/backend projects instead of one. In production, Fastify serves the SPA build from the same origin, so CORS is only needed in dev (the Vite proxy handles that).
- **Revisit if:** we add a marketing site, SEO pages, or shareable result pages that need server-rendered OG previews.

### ADR-002: Deployment deferred; build local-first, deploy-ready

- **Status:** decision deferred. Revisit once the app is feature complete.
- **Context:** the brief lists a live URL as a deliverable and evaluates production deployment. The current plan is to run locally, record a demo video and publish the code on GitHub. Hosting can be added later in the review window if needed.
- **Decision for now:** build so that deploying is a configuration change, not a rewrite:
  - The whole stack runs with **`docker compose up`** (Postgres + backend + web). The same images are what would ship to production.
  - All config via env vars, validated at boot. No hard-coded hosts or paths.
  - Storage, AI provider and queue sit behind interfaces with local and production implementations (local disk → S3/R2, Mock → Claude).
  - Works **with no API keys** (mock content generator), so anyone can clone and run it.
- **Options when we decide:**
  1. **Railway/Render** for the backend (API + worker as two services from one image) plus managed Postgres, R2 for files. Roughly $5–10 for the review window. Gives reviewers a live URL.
  2. **Single VM** (e.g. a small Hetzner/DigitalOcean box) running the same `docker compose` with Caddy for HTTPS. Cheapest, closest to local.
  3. **Not hosted:** strong README, one-command setup, demo video, and an explicit note in the implementation notes on why it isn't hosted and how it would deploy.
- **Risk if we stay on option 3:** reviewers checking against the deliverables list may mark down "live URL" and "production deployment". This is mitigated by the deploy-ready setup and by stating it openly.

### ADR-003: Honest scraper identity; blocked sites fall back to image upload

- **Context:** many large stores (and Shopify's bot protection) refuse automated requests with 403/429. A common workaround is to fake a desktop browser's User-Agent or use headless browsers to get past bot checks.
- **Decision:** the scraper identifies itself honestly (`PostcraftBot/0.1; product link preview`), like link-preview bots do. When a site refuses, the job fails fast with `SITE_BLOCKED` and tells the user to upload a product image instead.
- **Why:** circumventing a site's bot protection is a legal and ethical risk for a real product, and it is an arms race we would lose anyway. The image-upload path (P0) gives a reliable alternative that needs no scraping at all.
- **Evolution:** official integrations for scale (e.g. Shopify Storefront API, merchant-provided product feeds), where access is granted rather than taken.

### Tech choices (and why)

| Concern | Choice | Rationale / alternative considered |
|---|---|---|
| Language | **TypeScript end to end**, npm workspaces monorepo | Shared Zod schemas between UI, API and worker; one toolchain; no extra package manager to install |
| Web/UI | **React + Vite SPA**, Tailwind v4 with a few hand-written components, TanStack Query, React Router | Interactive tool with no SSR/SEO needs (ADR-001). shadcn/ui was considered; a handful of small components is less code than its generator setup at this size |
| API | **Fastify** + Zod type provider, `@fastify/rate-limit`, `@fastify/helmet`, `@fastify/multipart` | Mature plugins for validation, rate limiting, security headers and streaming uploads |
| Queue | **pg-boss** (queue on Postgres) | Retries, backoff, expiry and singleton jobs without running Redis. Job row and queue entry are written in one transaction. BullMQ + Redis was considered: more throughput than we need, plus one more service |
| DB | **Postgres 16 + Drizzle ORM** | Relational job/asset/event model, typed queries, plain SQL migrations |
| Storage | **`StorageProvider` interface**: local disk now, S3/R2 adapter for production | No extra service locally. Downloads go through short-lived **HMAC-signed URLs**, the same security idea as S3 presigned URLs |
| Rendering | **FFmpeg** (filtergraph) + **sharp** for text cards (SVG → PNG) | FFmpeg is robust and standard. Pre-rendering text as PNG gives real typography and auto-fit (FFmpeg's drawtext is limited). Remotion was considered: nicer DX but heavier, slower to render, and has licensing caveats |
| AI | **`ContentProvider` interface**: **MockProvider (default)** and **ClaudeProvider** (vision + structured JSON) when `ANTHROPIC_API_KEY` is set | Covers the "simulated generation" requirement, makes the app runnable by anyone, and keeps the demo resilient |
| Scraping | `undici` fetch + `cheerio`, parsing **JSON-LD `Product`**, OpenGraph, then `<img>` heuristics | Most e-commerce pages expose JSON-LD/OG. A headless browser is a P2 fallback |
| Status updates | **Polling** `GET /jobs/:id` every ~1.5s via TanStack Query (stops when the job ends) | Simple, works behind any proxy, easy to reason about. SSE is a P2 enhancement |
| Observability | pino structured logs (jobId on every line), `job_events` table | Each job can be traced from the UI timeline to the logs |

---

## 3. Domain model

```
jobs
  id (uuid), session_id, status, current_step, progress (0-100)
  input_type: url | image | video
  input_url (nullable), input_asset_id (nullable)
  platform: instagram | tiktok | youtube
  format_id: e.g. "ig_reel", "ig_feed", "yt_short", "yt_thumb"
  options (jsonb): template, target duration, tone
  product (jsonb): scraped/analyzed product data
  script (jsonb): AI output, user-editable
  provider: mock | claude
  error_code, error_message, attempts
  created_at, updated_at, completed_at

assets
  id, job_id (nullable for uploads), session_id
  kind: source_image | source_video | output_video | output_image | thumbnail
  storage_key, mime, bytes, width, height, duration_ms, sha256

job_events            (append-only timeline, drives the status UI)
  id, job_id, step, level, message, created_at
```

### Job state machine

```
queued → ingesting → analyzing → scripting → [awaiting_review] → rendering → finalizing → completed
                         ↘───────────── any step ─────────────↘ failed (retryable | terminal)
                                                                 cancelled
```

- Each step is **idempotent** and saves its output (scraped data, script, intermediate files) before moving on. A retry **resumes from the last completed step** instead of starting over.
- Errors are classified as **retryable** (LLM 429/5xx, network timeouts: exponential backoff via pg-boss, at most 3 attempts) or **terminal** (blocked URL, no product images found, corrupt upload: fail fast with a user-facing message and a suggested fix).
- **Per-step timeouts** (for example scrape 15s, LLM 60s, render 180s). pg-boss job expiry re-queues work from a crashed worker.
- A **sweeper** marks jobs stuck past a TTL as failed, so the UI never spins forever.
- **Graceful shutdown:** on SIGTERM the worker stops claiming new jobs and finishes or releases the current one.

---

## 4. Platform format registry (format rules as data)

```ts
export const FORMATS = {
  ig_reel:  { platform: 'instagram', kind: 'video', w: 1080, h: 1920, targetSec: 20, maxSec: 60, fps: 30, safe: { top: 220, bottom: 420, right: 120 } },
  ig_feed:  { platform: 'instagram', kind: 'image', w: 1080, h: 1350 },             // 4:5
  ig_story: { platform: 'instagram', kind: 'video', w: 1080, h: 1920, targetSec: 15, maxSec: 60 },
  tt_video: { platform: 'tiktok',    kind: 'video', w: 1080, h: 1920, targetSec: 20, maxSec: 60, safe: { bottom: 480, right: 160 } },
  yt_short: { platform: 'youtube',   kind: 'video', w: 1080, h: 1920, targetSec: 20, maxSec: 60 },
  yt_thumb: { platform: 'youtube',   kind: 'image', w: 1280, h: 720 },              // 16:9
} as const;
```

- **Durations are product defaults, not platform limits.** The platforms allow much longer videos. We target 15–30s because that is what performs for short-form product content and it keeps render times low. **Safe-zone values are approximations** of where each app's UI overlays sit.
- The UI derives the "format" options from the selected platform (`GET /api/formats`). The worker derives dimensions, duration and safe zones from the same config.
- Output encoding: **H.264 High, yuv420p, AAC, `+faststart`, 30fps**, which plays everywhere.
- An integration test asserts every rendered output matches its spec (checked with `ffprobe`). This is the "format rules in the generated output" requirement, verified automatically.

---

## 5. Generation pipeline (P0 URL → Reel)

1. **Ingest:** SSRF-safe fetch of the URL. Extract title, price, description, brand and images from JSON-LD/OG/DOM. Download the top N images (size and type checked), dedupe by hash, and drop images that are too small. *(Image input skips the scrape and uses the uploaded file.)*
2. **Analyze:** with Claude, send product data and 1–3 images to vision and get category, key selling points and the best hero image. With Mock, derive these deterministically from the scraped text.
3. **Script:** the provider returns **schema-validated JSON** (Zod), retried once on invalid output:
   ```json
   { "hook": "...", "scenes": [{ "text": "...", "imageIndex": 0, "durationSec": 3 }],
     "cta": "...", "caption": "...", "hashtags": ["..."] }
   ```
   Scraped page text is passed as **quoted, untrusted data**, never as instructions (prompt-injection hygiene).
4. **(P1) Review:** the job pauses at `awaiting_review` and the UI shows editable fields. "Render" resumes it.
5. **Render:**
   - Pre-scale every image once to the output size. This keeps FFmpeg fast.
   - Each image becomes a scene: **blurred-fill background + contained foreground**, which avoids ugly crops of product shots in 9:16, plus a gentle zoom.
   - Text cards are rendered with sharp (SVG → PNG, auto-fit, inside safe zones) and overlaid with fades.
   - Scenes are joined with crossfades, with an optional royalty-free music bed. Encoded with `-preset veryfast`.
   - Also export a **poster/thumbnail** and the **4:5 feed image**.
6. **Finalize:** write to storage, write asset rows, ffprobe-verify against the spec, mark the job completed. The UI gets **short-lived signed URLs** for preview and download.

**Render-time budget:** a 20s 1080×1920 reel should render in under ~30s on a laptop. This is measured on Day 2, not at the end. FFmpeg's `zoompan` is slow at high resolutions, so if needed we use a cheaper scale/crop animation instead.

**Video input (P1):** ffprobe, then trim to the target duration, reframe (blurred pad or center crop), extract keyframes for the provider, and burn in the hook, captions and CTA overlays.

---

## 6. API surface

```
POST  /api/uploads              → multipart upload (streamed, size-capped, magic-byte checked) → { assetId }
POST  /api/jobs                 → 202 { jobId }   body: { inputType, url|assetId, platform, formatId, options }
GET   /api/jobs/:id             → job + events + script + outputs (signed URLs)   ← polled by the UI
PATCH /api/jobs/:id/script      → (planned) edit script (only while awaiting_review)
POST  /api/jobs/:id/render      → (planned) resume after review
POST  /api/jobs/:id/retry       → retry failed job from last good step
POST  /api/jobs/:id/cancel
GET   /api/files/:key?exp&sig   → signed, expiring download/preview (supports Range for video seeking)
GET   /api/formats              → registry (drives UI)
GET   /api/health               → db + storage + worker heartbeat
```

All request and response bodies are Zod-validated. An **Idempotency-Key** header on `POST /jobs` prevents duplicate jobs from double-clicks.

---

## 7. Security

| Risk | Mitigation |
|---|---|
| **SSRF via product URL** | http/https only; resolve DNS and **block private, loopback, link-local and metadata IPs** (169.254.169.254, IPv6 equivalents, decimal/octal-encoded IPs), re-checked on every redirect (stops DNS rebinding); max 3 redirects; 15s timeout; 5MB HTML cap. Image downloads go through the same guard |
| **Malicious uploads** | Streamed multipart with hard size limits (image 15MB, video 100MB); server verifies **magic bytes** (not the client's MIME type) and probes with sharp/ffprobe; outputs are always re-encoded; random storage keys, never user-supplied filenames |
| **FFmpeg as attack surface** | Fixed argument arrays via `spawn` (no shell), `-protocol_whitelist file`, per-render timeout, worker runs as non-root in its container |
| **Prompt injection from scraped pages** | Scraped content is delimited and treated as data; output is schema-validated; the model gets no tools or actions |
| **Abuse / cost** | Anonymous signed session cookie owns jobs; **rate limits** per session and IP; max concurrent jobs per session |
| **Data access** | Jobs and assets scoped to their session; files only reachable through **HMAC-signed, expiring URLs**; artifact cleanup after 7 days is planned (not built) |
| **Secrets** | Env vars only, validated at boot with Zod; `.env.example` committed, `.env` git-ignored; nothing sensitive in the client bundle |
| **Web basics** | Helmet security headers/CSP, CORS locked to the app origin, generic error messages to the client with details in the logs |

---

## 8. UX flow

1. **Create:** tabs for *URL / Image / Video*, platform cards (Instagram/TikTok/YouTube), and format chips filtered by platform, each showing an aspect-ratio preview box. Example product URLs are offered for one-click trials.
2. **Progress:** step timeline (Fetching product → Analyzing → Writing script → Rendering → Done) with a progress bar. Leaving the page is safe because the job keeps running and is resumable via `/jobs/:id`.
3. **Review (P1):** edit hook, scenes and CTA, and reorder or swap images.
4. **Result:** player framed in a phone mockup with a safe-zone overlay toggle. Download MP4/PNG, copy caption and hashtags, "Make another format from this job".
5. **Failure:** human-readable reason plus action ("This site blocks automated access. Upload the product image instead", "Retry").
6. A visible badge shows whether content came from **Mock** or **Claude**, so what's simulated is never hidden.

---

## 9. Real vs simulated (for the implementation notes)

| Capability | Status |
|---|---|
| URL scraping, image download, SSRF guard | **Real** |
| Image upload + validation | **Real** |
| Product analysis + script/caption | **Real with Claude** when `ANTHROPIC_API_KEY` is set; otherwise **MockProvider** (deterministic templates built from the scraped data). The UI badge shows which one ran |
| Video/image rendering to exact platform specs | **Real** (FFmpeg + sharp) |
| Queue, persistence, retries, resume | **Real** (Postgres + pg-boss) |
| Storage | **Real, local disk**; S3/R2 adapter documented for production |
| Hosted deployment | **Deferred** (ADR-002) |
| TTS voiceover | P2. Behind a `VoiceProvider` interface; off by default |
| Generative imagery (AI backgrounds, avatars) | Not built. Noted as a future direction |
| Publishing to platforms | Not built (needs OAuth + platform app review) |

---

## 10. Repo structure

```
/apps
  /web          React + Vite SPA (Tailwind, TanStack Query)
  /backend      One codebase, two entry points:
    src/server.ts   Fastify API: routes, validation, uploads, rate limits, signed files
    src/worker.ts   pg-boss worker: pipeline steps, ffmpeg, providers
    src/pipeline/   ingest | analyze | script | render | finalize
    src/providers/  content (mock, claude), storage (local, s3)
    src/security/   ssrf guard, upload validation, signing
    src/db/         Drizzle schema + migrations
/packages
  /shared       Zod schemas, format registry, job status types (used by web + backend)
docker-compose.yml   postgres + backend (api, worker) + web
Dockerfile           backend image (ffmpeg + fonts installed); run as api or worker
/docs
  DESIGN_AND_PLAN.md, IMPLEMENTATION_NOTES.md
README.md
```

Local dev: `docker compose up -d postgres`, then `npm run dev` (API, worker and Vite with hot reload). Full stack: `docker compose up`.

---

## 11. Testing strategy

- **Unit:** format registry and safe-zone math, scraper parsers (fixture HTML from 3–4 real shops), **SSRF guard** (private IPs, redirects, IPv6, encoded IPs), state machine transitions, provider output validation and repair, URL signing.
- **Integration:** worker pipeline with MockProvider on a fixture image produces an MP4. **ffprobe asserts width, height, duration and codec** per format.
- **E2E (planned, optional):** one Playwright happy path: submit URL, see progress, preview, download.
- Tooling today: Vitest, Prettier, `tsc --noEmit`. Planned: ESLint and a GitHub Actions workflow running typecheck and tests.

---

## 12. Running locally & deployment readiness

- **Prerequisites:** Docker (with compose), Node 22+. FFmpeg is only needed outside Docker.
- **One command:** `docker compose up` gives a working app at `http://localhost:8080` with the mock content generator. Adding `ANTHROPIC_API_KEY` to `.env` switches to Claude.
- Migrations run automatically on backend start; `/api/health` reports DB, storage and worker heartbeat.
- **Deploy-ready by design** (see ADR-002): same image for API and worker, env-only config, storage and AI behind interfaces.

---

## 13. Execution timeline (~6 working days)

| Day | Goal | Exit criteria |
|---|---|---|
| **1** | Skeleton: npm workspaces monorepo (web/backend/shared), docker compose Postgres, Drizzle schema + migrations, format registry, job create/status API, pg-boss worker running a no-op pipeline, polling status in the Vite UI | Job goes queued → completed with visible progress |
| **2** | URL ingest (SSRF-safe scraper) + MockProvider script + **first FFmpeg render of a 9:16 reel**; **measure render time** | URL → MP4 downloadable (mock copy) **← vertical slice done** |
| **3** | Image upload input, sharp text cards, crossfades, 4:5 feed image, signed file URLs, Claude provider | Both P0 inputs work; real AI content when a key is set |
| **4** | Failure handling: retry classification, step resume, timeouts, sweeper, cancel, error UX; rate limiting | Intentionally broken inputs fail gracefully |
| **5** | TikTok/YouTube formats, review/edit step, (video input if time allows), tests + CI | All P0 + most P1 done, CI green |
| **6** | **Clean-clone test** (fresh clone → README → `docker compose up` works), README, implementation notes, **demo video**; decide deployment (ADR-002) | All deliverables ready |

**Buffer rule:** if behind schedule, cut in this order: video input, then review step, then extra platforms. Never cut failure handling, security or docs, because those are what's being graded.

### Commit hygiene
Small, conventional commits per vertical step (`feat(backend): ssrf-safe product scraper`, `test(render): assert ig_reel output spec via ffprobe`). Decisions are recorded as ADRs in this document.

---

## 14. Demo video (≤5 min) outline

1. **0:00–0:30** Problem and what I chose to build (and not build).
2. **0:30–2:00** Happy path: paste product URL, choose Instagram Reel, live progress, edit script, render, preview, download. Then switch to TikTok from the same job. Show image upload briefly.
3. **2:00–2:45** Failure path: internal URL rejected (SSRF guard), a site with no product images gives a helpful fallback suggestion, a killed worker mid-render resumes.
4. **2:45–4:00** Architecture diagram, job state machine, format registry, real vs simulated.
5. **4:00–5:00** Trade-offs, deployment approach, next steps.

Rehearse with known-good URLs before recording.

---

## 15. What I'd do next (product evolution)

1. **Brand kits:** logo, colors and fonts per user, applied to every template. This is the biggest jump in perceived quality.
2. **Variants and A/B:** generate 3 hooks/templates per job; later, learn which perform best.
3. **Voiceover + auto-captions** (TTS + word-level timing), since most short-form video is watched with captions.
4. **Headless-browser scraping fallback** and Shopify/Amazon adapters for hard sites.
5. **Accounts, history, team workspaces**; then **direct publishing/scheduling** via platform APIs.
6. **Scale:** separate render worker pool (GPU or larger CPU), per-step queues, cost tracking per job, cache scrape and LLM results by URL hash, SSE/WebSocket live updates.

---

## 16. Design review: revisions (Revision 2)

| Change | Before | After | Why |
|---|---|---|---|
| Queue | BullMQ + Redis | pg-boss on Postgres | One less service; job row + queue entry in one transaction |
| Backend layout | Separate `api` and `worker` apps | One `backend` codebase, two entry points | Half the build/dependency overhead, same process isolation |
| Live status | SSE | Polling | Simpler, proxy-proof; SSE moved to P2 |
| Image upload | P1 | P0 | Scraping is the riskiest dependency; guarantees a working demo path |
| Storage | Cloudflare R2 | Local disk behind `StorageProvider` (S3 adapter for prod) | Runs locally with no extra service; still deploy-ready |
| Uploads | S3 presigned PUT | Streamed multipart to the API | Fits local storage; same validation guarantees |
| AI default | Claude | MockProvider, Claude when key is set | Anyone can clone and run it with no keys |
| Durations | Stated as platform maximums | Product defaults (15–30s); safe zones marked approximate | Platform limits have changed; earlier numbers were outdated |
| Deployment | Railway/Render | Deferred, deploy-ready (ADR-002) | Build first; decide hosting with the app in hand |
| Package manager | pnpm | npm workspaces | Already installed; nothing extra for anyone cloning the repo |
