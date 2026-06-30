# =============================================
# SignalMash Connect - Server Dockerfile (pnpm overlay)
# =============================================
FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++ openssl \
 && corepack enable \
 && corepack prepare pnpm@9.0.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/

RUN pnpm install --frozen-lockfile --filter "@signalmash-connect/server..." --filter "@signalmash-connect/shared..."

COPY packages/shared ./packages/shared
COPY packages/server ./packages/server

# Generate Prisma client BEFORE tsc build (types depend on it)
RUN pnpm --filter "@signalmash-connect/server" exec prisma generate \
 && pnpm --filter "@signalmash-connect/shared" build \
 && pnpm --filter "@signalmash-connect/server" build

# ----- Production stage -----
FROM node:20-alpine AS production

WORKDIR /app

RUN apk add --no-cache openssl \
 && corepack enable \
 && corepack prepare pnpm@9.0.0 --activate \
 && addgroup -g 1001 -S nodejs \
 && adduser -S nodejs -u 1001

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/

RUN pnpm install --frozen-lockfile --prod --filter "@signalmash-connect/server..." --filter "@signalmash-connect/shared..."

COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/server/dist ./packages/server/dist
COPY --from=builder /app/packages/server/prisma ./packages/server/prisma
# Copy generated Prisma client (pnpm puts it in .pnpm store, the symlink is in node_modules)
COPY --from=builder /app/node_modules/.pnpm ./node_modules/.pnpm
COPY --from=builder /app/packages/server/node_modules ./packages/server/node_modules

RUN chown -R nodejs:nodejs /app

USER nodejs
WORKDIR /app/packages/server

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/index.js"]
