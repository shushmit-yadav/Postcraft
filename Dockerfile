# One image for the whole app: Fastify API (which also serves the built UI) and the worker.
# Run it as `node dist/server.js` (api) or `node dist/worker.js` (worker).

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/backend/package.json apps/backend/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
# FFmpeg renders video; DejaVu is the font the text overlays are laid out for.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    STORAGE_DIR=/app/data/storage \
    WEB_DIST_DIR=/app/apps/web/dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/backend/package.json ./apps/backend/package.json
COPY --from=build /app/apps/backend/dist ./apps/backend/dist
COPY --from=build /app/apps/backend/drizzle ./apps/backend/drizzle
COPY --from=build /app/apps/web/dist ./apps/web/dist
RUN mkdir -p /app/data/storage && chown -R node:node /app/data
USER node
WORKDIR /app/apps/backend
EXPOSE 8080
CMD ["node", "dist/server.js"]
