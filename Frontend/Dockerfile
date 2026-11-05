# TeleSpy frontend image (Next.js standalone server). Built by
# .github/workflows/deploy.yml and pushed to GHCR; the Azure VM only pulls
# it (see deploy/docker-compose.yml).
#
# NEXT_PUBLIC_API_URL is read at build time and baked into the browser
# bundle, so it's a build argument, not a runtime env var. The default,
# "/api", is relative: Caddy sends /api/* on the same host to the API
# container, so one image works on any domain.
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* .npmrc* ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
ARG NEXT_PUBLIC_API_URL=/api
ARG NEXT_PUBLIC_BUILD_LABEL=dev
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_BUILD_LABEL=$NEXT_PUBLIC_BUILD_LABEL \
    NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
# `pnpm build` already copied public/ and .next/static/ into the
# standalone folder (scripts/copy-standalone-assets.mjs).
COPY --from=build --chown=node:node /app/.next/standalone ./
USER node
EXPOSE 3000
CMD ["node", "server.js"]
