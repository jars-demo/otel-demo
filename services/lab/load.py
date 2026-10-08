"""A small, bounded load generator. It only ever calls the lab's own api-gateway.

Limits are hard-coded on purpose: at most 20 requests per second, for at most 15 minutes, one run
at a time. Enough to make metrics move and incidents show up; never enough to hurt your machine.
"""

from __future__ import annotations

import asyncio
import logging
import random
import time
from collections import Counter, deque
from typing import Literal

import httpx
from pydantic import BaseModel, Field

from inventory.store import PRODUCT_IDS

log = logging.getLogger(__name__)

MAX_RPS = 20
MAX_DURATION_S = 900

Scenario = Literal["checkout", "browse", "mixed"]


class LoadRequest(BaseModel):
    scenario: Scenario = "mixed"
    rps: float = Field(5, gt=0, le=MAX_RPS)
    duration_s: int = Field(60, ge=5, le=MAX_DURATION_S)


class LoadGenerator:
    def __init__(self, gateway: httpx.AsyncClient, seed: int | None = None) -> None:
        self.gateway = gateway
        self.random = random.Random(seed)
        self.task: asyncio.Task | None = None
        self.config: LoadRequest | None = None
        self.started_at: float | None = None
        self.sent = 0
        self.statuses: Counter[str] = Counter()
        self.latencies: deque[float] = deque(maxlen=500)
        self._inflight: set[asyncio.Task] = set()

    @property
    def running(self) -> bool:
        return self.task is not None and not self.task.done()

    def start(self, config: LoadRequest) -> None:
        self.stop()
        self.config = config
        self.started_at = time.monotonic()
        self.sent = 0
        self.statuses.clear()
        self.latencies.clear()
        self.task = asyncio.create_task(self._run(config))
        log.info("load started", extra={"lab.load": config.model_dump()})

    def stop(self) -> None:
        if self.running:
            self.task.cancel()
            log.info("load stopped")

    def status(self) -> dict:
        ordered = sorted(self.latencies)
        elapsed = time.monotonic() - self.started_at if self.started_at else 0

        def pct(p: float) -> float | None:
            return round(ordered[int(p * (len(ordered) - 1))] * 1000, 1) if ordered else None

        return {
            "running": self.running,
            "config": self.config.model_dump() if self.config else None,
            "elapsed_s": round(min(elapsed, self.config.duration_s), 1) if self.config else 0,
            "sent": self.sent,
            "statuses": dict(self.statuses),
            "client_latency_ms": {"p50": pct(0.5), "p95": pct(0.95)},
            "limits": {"max_rps": MAX_RPS, "max_duration_s": MAX_DURATION_S},
        }

    async def _run(self, config: LoadRequest) -> None:
        deadline = time.monotonic() + config.duration_s
        next_at = time.monotonic()
        try:
            while time.monotonic() < deadline:
                # Fire and continue: a slow system must not slow the arrival rate, or latency
                # problems would hide themselves. In-flight requests are capped, though.
                if len(self._inflight) < MAX_RPS * 10:
                    task = asyncio.create_task(self._one(config.scenario))
                    self._inflight.add(task)
                    task.add_done_callback(self._inflight.discard)
                # Poisson arrivals: exponential gaps averaging 1/rps. Real users do not arrive
                # on a metronome, and the bursts are what make queues form.
                next_at += self.random.expovariate(config.rps)
                await asyncio.sleep(max(0, next_at - time.monotonic()))
        finally:
            log.info("load finished", extra={"lab.load.sent": self.sent})

    async def _one(self, scenario: Scenario) -> None:
        if scenario == "mixed":
            scenario = "checkout" if self.random.random() < 0.6 else "browse"
        started = time.perf_counter()
        try:
            if scenario == "checkout":
                response = await self.gateway.post("/api/checkout", json=self.cart())
            else:
                path = self.random.choice(["/api/products", f"/api/products/{self.product()}"])
                response = await self.gateway.get(path)
            key = str(response.status_code)
        except httpx.TimeoutException:
            key = "timeout"
        except httpx.HTTPError:
            key = "connection_error"
        self.sent += 1
        self.statuses[key] += 1
        self.latencies.append(time.perf_counter() - started)

    def product(self) -> str:
        return self.random.choice(PRODUCT_IDS)

    def cart(self) -> dict:
        lines = self.random.randint(1, 3)
        items = [
            {"product_id": pid, "quantity": self.random.randint(1, 3)}
            for pid in self.random.sample(PRODUCT_IDS, lines)
        ]
        return {"user_id": f"user-{self.random.randint(100, 199)}", "items": items}
