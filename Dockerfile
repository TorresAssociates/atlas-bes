# Multi-stage build. There is deliberately NO build/bundle stage: Bun runs
# TypeScript from source, and bundling would break @fastify/autoload, which
# scans the filesystem for src/modules/*/routes.ts at runtime.

FROM oven/bun:1-slim AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
# tsconfig.json is needed at runtime: Bun reads its "paths" to resolve the
# @/* import alias when executing TypeScript from source.
COPY package.json tsconfig.json ./
COPY src ./src
USER bun
EXPOSE 3000
CMD ["bun", "src/server.ts"]
