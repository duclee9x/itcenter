ARG NODE_VERSION=24.21.0
FROM node:${NODE_VERSION}-bookworm-slim AS build

WORKDIR /app
COPY . .
RUN npm ci \
  && npm run build \
  && npm prune --omit=dev

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ARG APP_VERSION=0.0.0
ARG GIT_COMMIT=unknown
ARG BUILD_TIME=unknown
ARG SOURCE_REPOSITORY=unknown

ENV NODE_ENV=production \
    APP_VERSION=${APP_VERSION} \
    GIT_COMMIT=${GIT_COMMIT} \
    BUILD_TIME=${BUILD_TIME}

LABEL org.opencontainers.image.title="IT Operations Hub" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_COMMIT}" \
      org.opencontainers.image.created="${BUILD_TIME}" \
      org.opencontainers.image.source="${SOURCE_REPOSITORY}"

RUN apt-get update \
  && apt-get install --no-install-recommends -y openssl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/database/migrations ./database/migrations

USER node
EXPOSE 3000 3001 3002
CMD ["node", "dist/apps/api/src/main.js"]
