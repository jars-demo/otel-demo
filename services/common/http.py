"""Calling another service: an httpx client plus one place that maps failures to errors.

The httpx instrumentation (see `common.telemetry`) creates a CLIENT span for every request and
injects the W3C `traceparent` header, so the callee's SERVER span joins the same trace. That
header is the whole of context propagation; no service passes trace ids around by hand.
"""

from __future__ import annotations

import logging

import httpx

from common.errors import DependencyError, DependencyTimeout, ServiceError

log = logging.getLogger(__name__)


def service_client(base_url: str, timeout_s: float) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=base_url, timeout=httpx.Timeout(timeout_s, connect=min(1.0, timeout_s))
    )


async def call(
    client: httpx.AsyncClient,
    method: str,
    path: str,
    *,
    dependency: str,
    retries: int = 0,
    passthrough: tuple[int, ...] = (400, 404, 409, 422),
    **kwargs,
) -> httpx.Response:
    """Send a request. 2xx and `passthrough` codes are returned; anything else raises.

    `retries` retries only timeouts and connection errors, and only for idempotent calls.
    """
    attempt = 0
    while True:
        try:
            response = await client.request(method, path, **kwargs)
        except httpx.TimeoutException as exc:
            if attempt < retries:
                attempt += 1
                log.warning("retrying after timeout", extra={"peer.service": dependency})
                continue
            raise DependencyTimeout(f"{dependency} did not answer in time") from exc
        except httpx.TransportError as exc:
            if attempt < retries:
                attempt += 1
                continue
            raise DependencyError(f"{dependency} is unreachable: {type(exc).__name__}") from exc
        if response.is_success or response.status_code in passthrough:
            return response
        raise downstream_error(dependency, response)


def downstream_error(dependency: str, response: httpx.Response) -> ServiceError:
    try:
        detail = response.json().get("message") or response.json().get("detail")
    except ValueError:
        detail = None
    message = f"{dependency} returned {response.status_code}"
    if detail:
        message += f": {detail}"
    return DependencyError(message, code=f"{dependency.replace('-', '_')}_failed")
