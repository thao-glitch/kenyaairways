# Kenya Airways admin app — Next.js standalone output (small runtime image).
# NEXT_PUBLIC_* values are inlined at build time: pass them as build args.
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
ARG API_PUBLIC_URL=http://localhost:4100
ARG NEXT_PUBLIC_API_URL=http://localhost:4100
ARG NEXT_PUBLIC_ADMIN_URL=http://localhost:3001
ENV API_PUBLIC_URL=$API_PUBLIC_URL NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_PUBLIC_ADMIN_URL=$NEXT_PUBLIC_ADMIN_URL
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/admin/package.json apps/admin/
RUN pnpm install --frozen-lockfile --filter @kenyaairways/admin...
COPY packages/shared packages/shared
COPY apps/admin apps/admin
RUN pnpm --filter @kenyaairways/shared build && pnpm --filter @kenyaairways/admin build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3001 HOSTNAME=0.0.0.0
COPY --from=build /repo/apps/admin/.next/standalone ./
COPY --from=build /repo/apps/admin/.next/static ./.next/static
COPY --from=build /repo/apps/admin/public ./public
EXPOSE 3001
CMD ["node", "server.js"]
