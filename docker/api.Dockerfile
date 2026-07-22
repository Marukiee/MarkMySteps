# MarkMySteps API — multi-stage build
# Final image: non-root, production deps only.

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

# ---- Install dependencies (cached while lockfile is unchanged) ----
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @markmysteps/api

# ---- Build ----
FROM deps AS build
COPY tsconfig.base.json ./
COPY apps/api apps/api
RUN pnpm --filter @markmysteps/api db:generate \
 && pnpm --filter @markmysteps/api build \
 && pnpm --filter @markmysteps/api --prod deploy --legacy /out

# ---- Runtime ----
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/dist ./dist
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/package.json ./
COPY --from=build --chown=node:node /out/prisma ./prisma
USER node
EXPOSE 3000
# Apply pending migrations, then start the API. prisma is a regular
# dependency, so the CLI is present offline in node_modules.
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node dist/main.js"]
