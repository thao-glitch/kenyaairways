# Flight13 API — production image
# Build context is the repo root:  docker build -f apps/api/Dockerfile .
# NOTE: verified by CI (`docker` job); no local Docker daemon in this dev env.

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
# Workspace manifests first so dependency layers cache independently of source
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* .npmrc ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
RUN --mount=type=cache,id=pnpm-api,target=/pnpm/store pnpm install --frozen-lockfile || pnpm install
COPY tsconfig.base.json ./
COPY eslint.base.config.mjs ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @flight13/shared build \
 && pnpm --filter @flight13/api exec prisma generate \
 && pnpm --filter @flight13/api build

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo /repo
# Prune build-only tooling from the runtime layer (keeps prisma CLI for migrate deploy)
RUN pnpm --filter @flight13/api prune --prod || true
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://localhost:4000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "cd apps/api && npx prisma migrate deploy && node dist/main.js"]
