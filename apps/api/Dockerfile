# Flight13 API — NestJS + Prisma. Build the workspace, then run with a
# slim production stage; `prisma db push` runs at boot so the schema
# always matches the image.
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @flight13/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @flight13/shared build \
 && pnpm --filter @flight13/api exec prisma generate \
 && pnpm --filter @flight13/api build

FROM node:22-alpine
WORKDIR /repo
ENV NODE_ENV=production
RUN corepack enable && apk add --no-cache openssl libc6-compat
COPY --from=build /repo ./
WORKDIR /repo/apps/api
EXPOSE 4100
CMD ["sh", "-c", "pnpm exec prisma db push --skip-generate && node dist/main.js"]
