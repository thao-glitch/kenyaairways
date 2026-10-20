# Flight13 user app — Next.js standalone output (small runtime image).
# NEXT_PUBLIC_* values are inlined at build time: pass them as build args.
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
ARG API_PUBLIC_URL=http://localhost:4100
ARG NEXT_PUBLIC_API_URL=http://localhost:4100
ENV API_PUBLIC_URL=$API_PUBLIC_URL NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @flight13/web...
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @flight13/shared build && pnpm --filter @flight13/web build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./.next/static
COPY --from=build /repo/apps/web/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
