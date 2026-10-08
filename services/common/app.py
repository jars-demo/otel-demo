"""The FastAPI app factory every service uses: health endpoints, instrumentation, entry point."""

from __future__ import annotations

import logging
import os
from collections.abc import Awaitable, Callable

import uvicorn
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

from common.errors import install_error_handlers
from common.logs import setup_logging
from common.telemetry import setup_telemetry, shutdown_telemetry

log = logging.getLogger(__name__)

# Paths with no tracing: probes and lab controls would otherwise bury the interesting traces.
EXCLUDED_URLS = "/health,/ready,/internal"

ReadyCheck = Callable[[], Awaitable[None]]


def create_service_app(
    *,
    title: str,
    version: str,
    lifespan=None,
    ready_checks: dict[str, ReadyCheck] | None = None,
) -> FastAPI:
    app = FastAPI(title=title, version=version, lifespan=lifespan)
    checks = ready_checks or {}

    @app.get("/health", tags=["health"])
    async def health() -> dict[str, str]:
        """Liveness: the process is up and serving HTTP. Says nothing about dependencies."""
        return {"status": "ok", "service": title, "version": version}

    @app.get("/ready", tags=["health"])
    async def ready() -> JSONResponse:
        """Readiness: every dependency this service needs answered. The telemetry backend is
        deliberately not one of them: losing observability must not take the shop down."""
        results: dict[str, str] = {}
        for name, check in checks.items():
            try:
                await check()
                results[name] = "ok"
            except Exception as exc:
                results[name] = f"error: {type(exc).__name__}"
        ok = all(value == "ok" for value in results.values())
        body = {"status": "ready" if ok else "not_ready", "checks": results}
        return JSONResponse(body, status_code=200 if ok else 503)

    install_error_handlers(app)
    # exclude_spans drops the ASGI "http receive" / "http send" sub-spans: one SERVER span per
    # request is what you want to read.
    FastAPIInstrumentor.instrument_app(
        app, excluded_urls=EXCLUDED_URLS, exclude_spans=["receive", "send"]
    )
    return app


def run(app_path: str, service_name: str, version: str) -> None:
    """Entry point: logging first, then telemetry, then the server."""
    setup_logging(service_name)
    setup_telemetry(service_name, version)
    port = int(os.getenv("PORT", "8000"))
    log.info("starting", extra={"server.port": port})
    try:
        # log_config=None keeps our JSON handlers instead of uvicorn's default formatters.
        uvicorn.run(app_path, host="0.0.0.0", port=port, log_config=None, proxy_headers=True)
    finally:
        shutdown_telemetry()
