"""Every fault the lab can inject, and the code that turns them on and off.

Two kinds of fault, one catalog:

* service faults: switches inside a service, changed through its /internal/faults endpoint
* network faults: a Toxiproxy "latency" toxic between a service and Redis or PostgreSQL

Everything is bounded (see `max`), local to the Docker network, and reversible with reset().
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass

import httpx

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Fault:
    id: str
    label: str
    description: str
    target: str  # the service or data store affected
    kind: str  # "int" or "bool"
    unit: str = ""
    max: int = 1
    # Where it lives: a service's fault field, or a Toxiproxy proxy name.
    service: str | None = None
    field: str | None = None
    proxy: str | None = None


CATALOG: list[Fault] = [
    Fault(
        "gateway.latency_ms", "Add API latency", "Delay every request at the gateway.",
        target="api-gateway", kind="int", unit="ms", max=5000,
        service="api-gateway", field="latency_ms",
    ),
    Fault(
        "gateway.error_rate_percent", "Increase API error rate",
        "The gateway rejects this share of requests with HTTP 503.",
        target="api-gateway", kind="int", unit="%", max=50,
        service="api-gateway", field="error_rate_percent",
    ),
    Fault(
        "redis.latency_ms", "Add Redis latency",
        "Toxiproxy delays every command inventory-service sends to Redis.",
        target="redis", kind="int", unit="ms", max=5000, proxy="redis",
    ),
    Fault(
        "postgres.latency_ms", "Add database latency",
        "Toxiproxy delays every query order-service and payment-service send to PostgreSQL.",
        target="postgres", kind="int", unit="ms", max=3000, proxy="postgres",
    ),
    Fault(
        "payment.fail_payments", "Fail payment requests",
        "The payment provider times out; payment-service answers HTTP 503.",
        target="payment-service", kind="bool", service="payment-service", field="fail_payments",
    ),
    Fault(
        "inventory.error_every_n", "Return inventory errors",
        "Every n-th stock reservation fails with HTTP 500.",
        target="inventory-service", kind="int", unit="n", max=10,
        service="inventory-service", field="error_every_n",
    ),
    Fault(
        "inventory.latency_ms", "Slow downstream service",
        "inventory-service spends this long in its own reservation code.",
        target="inventory-service", kind="int", unit="ms", max=5000,
        service="inventory-service", field="latency_ms",
    ),
    Fault(
        "orders.hold_connection_during_checkout", "Hold DB connections during checkout",
        "order-service keeps a connection checked out across the inventory and payment calls, "
        "and its pool shrinks to 2.",
        target="order-service", kind="bool",
        service="order-service", field="hold_connection_during_checkout",
    ),
]  # fmt: skip
BY_ID = {fault.id: fault for fault in CATALOG}


class FaultError(ValueError):
    pass


class FaultController:
    def __init__(self, http: httpx.AsyncClient, service_urls: dict[str, str], toxiproxy_url: str):
        self.http = http
        self.service_urls = service_urls
        self.toxiproxy_url = toxiproxy_url

    @classmethod
    def from_env(cls, http: httpx.AsyncClient) -> FaultController:
        urls = {
            "api-gateway": os.getenv("GATEWAY_URL", "http://localhost:8400"),
            "order-service": os.getenv("ORDERS_URL", "http://localhost:8002"),
            "inventory-service": os.getenv("INVENTORY_URL", "http://localhost:8003"),
            "payment-service": os.getenv("PAYMENT_URL", "http://localhost:8004"),
        }
        return cls(http, urls, os.getenv("TOXIPROXY_URL", "http://localhost:8474"))

    async def current(self) -> dict[str, int | bool | None]:
        """Read every fault's live value from the services and Toxiproxy (None if unreachable)."""
        values: dict[str, int | bool | None] = {}
        service_state: dict[str, dict | None] = {}
        for service, url in self.service_urls.items():
            try:
                response = await self.http.get(f"{url}/internal/faults", timeout=2)
                service_state[service] = response.json()
            except httpx.HTTPError:
                service_state[service] = None
        proxies = await self._proxies()
        for fault in CATALOG:
            if fault.service:
                state = service_state.get(fault.service)
                values[fault.id] = None if state is None else state.get(fault.field)
            else:
                proxy = (proxies or {}).get(fault.proxy, {})
                toxics = {t["name"]: t for t in proxy.get("toxics", [])}
                latency = toxics.get("latency", {}).get("attributes", {}).get("latency", 0)
                values[fault.id] = None if proxies is None else latency
        return values

    async def apply(self, changes: dict[str, int | bool]) -> dict[str, int | bool | None]:
        """Change some faults; the others keep their values."""
        validated = {
            fault_id: self._validate(fault_id, value) for fault_id, value in changes.items()
        }
        by_service: dict[str, dict[str, int | bool]] = {}
        for fault_id, value in validated.items():
            fault = BY_ID[fault_id]
            if fault.service:
                by_service.setdefault(fault.service, {})[fault.field] = value
            else:
                await self._set_latency(fault.proxy, int(value))
        for service, fields in by_service.items():
            url = self.service_urls[service]
            response = await self.http.get(f"{url}/internal/faults", timeout=2)
            merged = {**response.json(), **fields}
            response = await self.http.put(f"{url}/internal/faults", json=merged, timeout=5)
            response.raise_for_status()
        log.warning("faults changed", extra={"lab.fault_changes": str(validated)})
        return await self.current()

    async def reset(self) -> dict[str, int | bool | None]:
        for url in self.service_urls.values():
            try:
                await self.http.post(f"{url}/internal/faults/reset", timeout=5)
            except httpx.HTTPError:
                log.warning("could not reset faults", extra={"url.full": url})
        for proxy in {f.proxy for f in CATALOG if f.proxy}:
            await self._set_latency(proxy, 0)
        return await self.current()

    async def restock(self) -> None:
        await self.http.post(
            f"{self.service_urls['inventory-service']}/internal/restock", timeout=5
        )

    # --- helpers -------------------------------------------------------------------------------

    def _validate(self, fault_id: str, value: int | bool) -> int | bool:
        fault = BY_ID.get(fault_id)
        if fault is None:
            raise FaultError(f"unknown fault {fault_id}")
        if fault.kind == "bool":
            if not isinstance(value, bool):
                raise FaultError(f"{fault_id} must be true or false")
            return value
        if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= fault.max:
            raise FaultError(f"{fault_id} must be an integer from 0 to {fault.max}")
        return value

    async def _proxies(self) -> dict | None:
        try:
            response = await self.http.get(f"{self.toxiproxy_url}/proxies", timeout=2)
            return response.json()
        except httpx.HTTPError:
            return None

    async def _set_latency(self, proxy: str, latency_ms: int) -> None:
        base = f"{self.toxiproxy_url}/proxies/{proxy}/toxics"
        await self.http.delete(f"{base}/latency", timeout=2)  # 404 when absent: fine
        if latency_ms > 0:
            toxic = {
                "name": "latency",
                "type": "latency",
                "stream": "upstream",
                "attributes": {"latency": latency_ms, "jitter": 0},
            }
            response = await self.http.post(base, json=toxic, timeout=2)
            response.raise_for_status()
