# syntax=docker/dockerfile:1

FROM node:20-bookworm AS frontend-build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm ci --prefix frontend
COPY config ./config
COPY frontend ./frontend
RUN npm run build --prefix frontend

FROM node:20-bookworm AS backend-build
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./backend/
RUN npm ci --prefix backend
COPY backend ./backend
RUN npm run build --prefix backend

FROM node:20-bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 \
    gawk \
    bash \
    coreutils \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/package.json backend/package-lock.json ./backend/
RUN npm ci --prefix backend --omit=dev

COPY --from=backend-build /app/backend/dist ./backend/dist
COPY backend/scripts ./backend/scripts
COPY --from=frontend-build /app/frontend/dist ./frontend/dist
COPY config ./config
COPY scripts ./scripts
COPY data/synthetic ./data/synthetic
COPY data/seed-batches ./data/seed-batches

RUN mkdir -p /app/data/batches

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    NETOPT_PYTHON=python3

EXPOSE 3001
VOLUME ["/app/data/batches"]

CMD ["node", "backend/dist/server.js"]
