# Multi-stage: build the workspace, ship only the server + its runtime deps.
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
RUN pnpm install --frozen-lockfile || pnpm install
COPY packages/core packages/core
COPY packages/server packages/server
RUN pnpm --filter @linkedin-engine/core build && pnpm --filter @linkedin-engine/server build
RUN pnpm --filter @linkedin-engine/server --prod deploy /out

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out ./
EXPOSE 4400
# Codex/Claude CLI providers need those binaries on PATH; the HTTP providers do not.
CMD ["node", "dist/index.js"]
