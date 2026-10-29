# Local, single-owner packaging. No credentials or subscription auth in layers.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS local
ARG CODEX_VERSION=0.151.0
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates lsof \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global --ignore-scripts "@openai/codex@${CODEX_VERSION}"
WORKDIR /app
COPY --from=build /app /app
RUN mkdir -p /app/.data /home/node/.codex /app/.backups \
    && chown -R node:node /app/.data /home/node/.codex /app/.backups \
    && chmod 700 /app/.data /home/node/.codex /app/.backups
USER node
ENV NODE_ENV=production GUIDEKIT_DATA_DIR=/app/.data CODEX_HOME=/home/node/.codex
# The application still binds 127.0.0.1. Compose uses host networking deliberately.
CMD ["node", "--import", "tsx", "apps/server/src/index.ts"]
