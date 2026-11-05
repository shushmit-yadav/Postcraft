# Postcraft

Turn a product page or photo into social-media-ready content. Paste a product URL (or upload a product photo with its name), pick a platform (Instagram, TikTok or YouTube) and a format, and Postcraft generates a video or image sized to that platform's rules, with a caption and hashtags. You watch progress live, preview the result and download it.

- **Design and plan:** [docs/DESIGN_AND_PLAN.md](docs/DESIGN_AND_PLAN.md), with the decision records (ADR-001 to ADR-003)
- **What's real, simulated, known issues and next steps:** [docs/IMPLEMENTATION_NOTES.md](docs/IMPLEMENTATION_NOTES.md)

## Quick start (Docker, one command)

Requires Docker with Compose.

```bash
cp .env.example .env          # set APP_SECRET to any random string of 32+ characters
docker compose up --build     # first build takes ~4 minutes
```

Open **http://localhost:8080**, click one of the example URLs, and press **Generate**.

No API keys are needed. Without `ANTHROPIC_API_KEY` the app uses a built-in mock content generator, and the UI says so ("AI: Mock (simulated)").

Compose runs three containers from one image: `postgres`, `api` (Fastify, which also serves the UI) and `worker` (the generation pipeline). Uploaded and generated files live in the `storage` volume.

## Local development

Requires Node 22+, Docker (for Postgres), FFmpeg, and the DejaVu fonts (`fonts-dejavu-core` on Debian/Ubuntu).

```bash
npm install
cp .env.example .env
npm run db:up                 # Postgres only, in Docker
npm run dev                   # API :8080 + worker + Vite UI on http://localhost:5173 (hot reload)
```

Stop the full Compose stack first (`docker compose stop api worker`) if it is running: both use port 8080, and two workers would share the same queue.

| Command | What it does |
|---|---|
| `npm test` | Unit tests (format rules, SSRF guard, product parser, text and card layout) and a render integration test that checks real FFmpeg output against the format rules. CI runs these on every push |
| `npm run typecheck` | TypeScript across all packages |
| `npm run build` | Production builds (backend bundle + UI) |
| `npm run render:sample -w @app/backend` | Renders every format from a sample image, without the database. Useful for tuning layouts and timing renders |

## How it works

```
React SPA ──REST (polling)──▶ Fastify API ──insert job + enqueue (one transaction)──▶ Postgres (+ pg-boss queue)
                                   │                                                        │
                                   └── signed file URLs ──▶ Storage (local disk) ◀── Worker ┘ claims job
                                                                                     │
                                                         scrape → analyze → script → render (FFmpeg) → verify
```

1. **The API never does heavy work.** It validates the request, saves the job and queues it in the same database transaction, then answers `202 { jobId }`.
2. **The worker runs the pipeline** in five steps. Each step saves its result (a checkpoint) before the next starts, so a retry resumes from the last finished step:
   - **ingesting:** (URL jobs only; image jobs are created with their product already set) fetch the page through the SSRF guard, extract the product (JSON-LD → microdata → OpenGraph → HTML) and download up to 4 product images.
   - **analyzing / scripting:** the content provider writes the hook, scenes, call to action, caption and hashtags. The mock is used today.
   - **rendering:** sharp draws each scene (gradient background, product card, text inside the platform safe zone). FFmpeg animates and crossfades the scenes into H.264/AAC MP4, or a PNG for image formats.
   - **finalizing:** each output is checked with ffprobe against its format's dimensions, codec and duration.
3. **The UI polls** `GET /api/jobs/:id` every 1.5s, showing the step timeline and an activity log. Once done, it shows a preview at the true aspect ratio with a toggle that shades where the platform's own UI covers the content.

**Failure handling:**
- Temporary errors (timeouts, site 5xx) retry automatically, 3 times with backoff.
- Permanent errors (blocked site, 404, no usable images, internal address) fail at once with a message telling the user what to do.
- A crashed worker's job is picked up by another worker within about 35s (pg-boss heartbeats).
- A sweeper fails jobs stuck for 20 minutes, so the UI never spins forever.
- Users can cancel, and retry from the last checkpoint.

## Platform formats

The rules live in one registry ([packages/shared/src/formats.ts](packages/shared/src/formats.ts)). The UI pickers and the renderer both read it.

| Platform | Format | Output | Size | Target length |
|---|---|---|---|---|
| Instagram | Reel | MP4 | 1080×1920 (9:16) | ~15s |
| Instagram | Story | MP4 | 1080×1920 (9:16) | ~12s |
| Instagram | Feed post | PNG | 1080×1350 (4:5) | n/a |
| TikTok | Video | MP4 | 1080×1920 (9:16) | ~15s |
| YouTube | Short | MP4 | 1080×1920 (9:16) | ~15s |
| YouTube | Thumbnail | PNG | 1280×720 (16:9) | n/a |

Durations are product defaults for short product videos, not platform maximums. Safe-zone margins approximate where each app draws its own buttons and captions.

## Technology choices

| Concern | Choice | Why (details in the ADRs) |
|---|---|---|
| UI | React + Vite SPA, Tailwind, TanStack Query | Interactive tool with no SEO needs, so no SSR framework (ADR-001) |
| API | Fastify + Zod | Schema validation, rate limiting and security headers as mature plugins |
| Queue | pg-boss on Postgres | Retries, backoff and heartbeats without running Redis; job row and queue entry commit together |
| Database | Postgres 16 + Drizzle | Typed queries, SQL migrations that run automatically on start |
| Rendering | FFmpeg + sharp | Standard, fast, scriptable. Text is laid out in SVG for real typography |
| Content | `ContentProvider` interface, mock by default | Runs with no keys; Claude plugs in behind the same interface |
| Storage | `StorageProvider` interface, local disk | No extra service locally; an S3/R2 adapter is the production path |

One npm workspaces monorepo: `apps/web` (UI), `apps/backend` (API and worker: one codebase, two entry points), and `packages/shared` (Zod schemas and the format registry, used by both).

## Configuration

All configuration is environment variables, validated at startup ([apps/backend/src/config.ts](apps/backend/src/config.ts)). See [.env.example](.env.example).

| Variable | Default | Notes |
|---|---|---|
| `APP_SECRET` | required | 32+ characters. Signs session cookies and file URLs |
| `DATABASE_URL` | required | Compose sets it for the containers |
| `ANTHROPIC_API_KEY` | empty | Empty = mock content generator |
| `WORKER_CONCURRENCY` | `2` | Parallel jobs per worker (rendering is CPU-heavy) |
| `STORAGE_DIR` | `./data/storage` | Where uploads and outputs are written |

## Security

- **Product URLs (SSRF guard):**
  - Only http/https on standard ports, with no credentials in the URL.
  - Every address is checked at DNS-resolution time against private, loopback, link-local/metadata and IPv4-mapped ranges. The address checked is the address connected to.
  - Redirects are re-checked on every hop (at most 3), with timeouts and size limits.
- **Images:** checked by their magic bytes, size-limited, and re-encoded before storage, which strips metadata. Text from scraped pages is escaped before it goes into SVG.
- **Access:**
  - Jobs and files belong to an anonymous signed session cookie, so one browser can't read another's jobs.
  - Files are served only through expiring HMAC-signed URLs.
- **Abuse:** rate limits, Helmet security headers, FFmpeg run without a shell, and the container runs as a non-root user.

## Assumptions and limitations

Full list in [docs/IMPLEMENTATION_NOTES.md](docs/IMPLEMENTATION_NOTES.md). The main ones:

- **Script writing is simulated.** The mock builds copy from the page text. The Claude provider is not built yet.
- **Inputs:** product URL and image upload work. Video upload is not built yet.
- **Many big stores block automated access (403/429).** The scraper identifies itself honestly and does not try to get around bot protection (ADR-003). Those sites fail with a clear message pointing to image upload.
- **No background music.** Videos carry a silent audio track.
- **Not hosted anywhere yet** (ADR-002). Run it locally with Docker.
