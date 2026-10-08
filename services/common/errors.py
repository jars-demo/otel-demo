"""Errors a service raises on purpose, and how they become HTTP responses.

Raise a `ServiceError` inside a span and the span records the exception (an `exception` event
with type, message and stack trace) and gets status ERROR. The handler below then logs it, with
the trace context, and returns a small JSON body. That is the whole error path:

    span: exception event + status ERROR     where it happened in the request
    log:  ERROR record with trace_id         what the component reported
    HTTP: status code + {"error": ...}       what the caller sees
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

log = logging.getLogger(__name__)


class ServiceError(Exception):
    status_code = 500
    code = "internal_error"

    def __init__(self, message: str, *, status_code: int | None = None, code: str | None = None):
        super().__init__(message)
        self.message = message
        if status_code is not None:
            self.status_code = status_code
        if code is not None:
            self.code = code


class DependencyError(ServiceError):
    """A downstream service or data store failed. Maps to 502 at the edge."""

    status_code = 502
    code = "dependency_failed"


class DependencyTimeout(ServiceError):
    status_code = 504
    code = "dependency_timeout"


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ServiceError)
    async def handle_service_error(request: Request, exc: ServiceError) -> JSONResponse:
        level = logging.ERROR if exc.status_code >= 500 else logging.WARNING
        log.log(
            level,
            exc.message,
            extra={
                "error.type": type(exc).__name__,
                "http.response.status_code": exc.status_code,
                "url.path": request.url.path,
            },
        )
        return JSONResponse(
            {"error": exc.code, "message": exc.message}, status_code=exc.status_code
        )
