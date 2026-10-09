# syntax=docker/dockerfile:1
# Flight13 web image: Next.js standalone output — the runtime stage carries
# only the traced server bundle, not the whole workspace.
FROM node:24-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.34.6 --activate
WORKDIR /app

# The browser bundle inlines this at build time; it must be the URL the
# *user's browser* can reach (host-mapped port), not the in-network name.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

# Manifests first for layer caching. apps/api's manifest + schema are needed
# because pnpm's frozen lockfile expects every workspace importer and the
# root postinstall runs `prisma generate`. `tsconfig.base.json` is extended
# by apps/web/tsconfig.json; `.npmrc` keeps pnpm behaviour identical to dev.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY .npmrc tsconfig.base.json eslint.base.config.mjs ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/api/prisma/schema.prisma apps/api/prisma/schema.prisma
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY apps/web apps/web
# transpilePackages compiles @flight13/shared — its entry resolves to dist.
RUN pnpm --filter @flight13/shared build && pnpm --filter @flight13/web build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
# Standalone output mirrors the workspace layout (apps/web/server.js).
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static apps/web/.next/static
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=6 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/" || exit 1
CMD ["node", "apps/web/server.js"]
