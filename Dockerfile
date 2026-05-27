FROM node:22-bookworm-slim AS build
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HEALTH_PORT=8080
ENV CONFIG_PATH=/data/config.json
ENV SQLITE_PATH=/data/messages.db
ENV RPC_JOURNAL_PATH=/data/rpc-journal.db

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates tini \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data \
  && chown -R node:node /app /data

COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules

COPY --from=build /app/dist ./dist
RUN chown -R node:node /app /data

USER node

# Default ports: health server (8080) and optional custom ports you expose externally
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${HEALTH_PORT:-8080}/readyz || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/index.js"]
