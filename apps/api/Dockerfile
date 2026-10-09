# syntax=docker/dockerfile:1
# Flight13 API image: pnpm workspace build → runtime that can migrate, seed
# and serve (see CMD). Single base so the Prisma engines generated in the
# build stage match the musl runtime exactly.
FROM node:24-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.34.6 --activate
WORKDIR /app

# Manifests first for layer caching. The Prisma schema must exist at install
# time: the workspace postinstall runs `prisma generate`. `.npmrc`,
# `tsconfig.base.json` and `eslint.base.config.mjs` are workspace-level files
# the build extends (tsconfig) or reads (pnpm).
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY .npmrc tsconfig.base.json eslint.base.config.mjs ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY apps/api/prisma/schema.prisma apps/api/prisma/schema.prisma
RUN pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @flight13/shared build && pnpm --filter @flight13/api build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
# The runtime keeps the full workspace node_modules instead of a --prod
# prune: `prisma migrate deploy` (CLI is a devDependency) and `prisma db
# seed` (tsx) run at boot, and `@flight13/shared` resolves through the
# workspace link. Nothing is downloaded at runtime — no .env in the image,
# secrets arrive via compose/env from `pnpm bootstrap`.
COPY --from=build /app /app
WORKDIR /app/apps/api
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=6 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-4000}/healthz" || exit 1
# migrate → seed (idempotent) → serve: one `docker compose up` yields a
# fully seeded mock stack.
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed && node dist/main.js"]
