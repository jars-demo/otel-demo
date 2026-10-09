# The website as a static export, served by an unprivileged nginx that also proxies /api to the
# api-gateway and /lab to the lab-console. Build from the repository root, because the site reads
# workshop/*.md, incidents/*/incident.yaml and infra/otel/collector.yaml at build time:
#
#   docker build -f frontend/Dockerfile -t otel-demo-web .
#
# Stage 1 installs dependencies (cached on package-lock.json), stage 2 builds, stage 3 is nginx
# with nothing but the static files: no Node.js, no node_modules, no source.

ARG NODE_IMAGE=node:22.23.3-alpine

FROM ${NODE_IMAGE} AS deps
WORKDIR /repo/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

FROM ${NODE_IMAGE} AS build
WORKDIR /repo/frontend
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /repo/frontend/node_modules ./node_modules
COPY frontend/ ./
COPY workshop/ /repo/workshop/
COPY incidents/ /repo/incidents/
COPY infra/otel/ /repo/infra/otel/
# The full app: live pages call /api and /lab on the same origin, which nginx proxies.
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.31.6-alpine AS runtime
LABEL org.opencontainers.image.title="otel-demo-web" \
      org.opencontainers.image.description="OpenTelemetry Incident Lab: website" \
      org.opencontainers.image.source="https://github.com/jars-demo/otel-demo" \
      org.opencontainers.image.licenses="MIT"
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/frontend/out /usr/share/nginx/html
# The base image already runs as nginx (uid 101); stated explicitly so it cannot drift.
USER 101
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD ["wget", "-qO-", "http://127.0.0.1:8080/healthz"]
