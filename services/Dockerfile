# One image for every Python service (api-gateway, order-service, inventory-service,
# payment-service, lab-console). Compose picks the service with the command, for example
# `python -m gateway`. Build from the repository root:
#
#   docker build -f services/Dockerfile -t otel-demo-service .
#
# Two stages: `build` resolves dependencies with uv into a virtualenv; the runtime stage copies
# only that virtualenv and the source, so no build tools, caches or uv end up in the final image.

ARG PYTHON_IMAGE=python:3.13.16-slim-trixie

FROM ${PYTHON_IMAGE} AS build
COPY --from=ghcr.io/astral-sh/uv:0.11.3 /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv
# Dependencies first, in their own layer: source edits do not reinstall them. The cache mount
# keeps downloaded wheels between builds without putting them in any layer.
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

FROM ${PYTHON_IMAGE} AS runtime
LABEL org.opencontainers.image.title="otel-demo-service" \
      org.opencontainers.image.description="OpenTelemetry Incident Lab: Python services" \
      org.opencontainers.image.source="https://github.com/jars-demo/otel-demo" \
      org.opencontainers.image.licenses="MIT"
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin app
WORKDIR /app
COPY --from=build /app/.venv /app/.venv
COPY services/ /app/
COPY incidents/ /incidents/
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
USER 10001
EXPOSE 8000
# /health is liveness only; readiness (dependencies) is /ready, checked by the lab-console.
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=10 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)"]
