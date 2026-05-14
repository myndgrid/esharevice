# Multi-stage build for the Express 5 + TypeScript API.
# tsx runs the TS source directly in production — small footprint, no transpile step.
# Built from the monorepo root: `docker build -f apps/api/Dockerfile -t esharevice-api .`

# ── 1. Base ────────────────────────────────────────────────
FROM node:20.10-alpine AS base
RUN apk add --no-cache libc6-compat tini wget
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

# ── 2. Install (prod + dev needed because tsx is dev) ──────
FROM base AS deps
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ── 3. Typecheck (fail the build if types are broken) ──────
FROM base AS check
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /repo/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /repo/packages/db/node_modules ./packages/db/node_modules
COPY . .
RUN pnpm --filter @esharevice/api typecheck

# ── 4. Prune to production install (drops devDependencies) ─
FROM base AS prune
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod
# tsx is needed at runtime — keep it as a "production runtime" dep by re-adding it.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @esharevice/api add tsx@^4.19.2

# ── 5. Runtime ─────────────────────────────────────────────
FROM node:20.10-alpine AS runner
WORKDIR /repo

RUN apk add --no-cache tini wget && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nodeapp

COPY --from=prune --chown=nodeapp:nodejs /repo/node_modules ./node_modules
COPY --from=prune --chown=nodeapp:nodejs /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=prune --chown=nodeapp:nodejs /repo/packages ./packages
COPY --chown=nodeapp:nodejs apps/api ./apps/api
COPY --chown=nodeapp:nodejs tsconfig.base.json ./

ENV NODE_ENV=production
ENV API_PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- http://localhost:8080/health || exit 1

USER nodeapp
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--import", "tsx/esm", "apps/api/src/index.ts"]
