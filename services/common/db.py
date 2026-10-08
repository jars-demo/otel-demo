"""PostgreSQL connection pool with the OpenTelemetry database client connection metrics.

Query spans come from the psycopg instrumentation library (see `common.telemetry`). What a
span cannot show is time spent *waiting for a connection*: that happens before any query starts.
So the pool reports the semantic-convention connection metrics (status: development):

    db.client.connection.count             connections, by state (used | idle)
    db.client.connection.max               the pool's upper bound
    db.client.connection.pending_requests  callers waiting for a connection
    db.client.connection.wait_time         how long callers waited (histogram, seconds)
    db.client.connection.timeouts          callers that gave up waiting
"""

from __future__ import annotations

import os
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from opentelemetry import metrics
from opentelemetry.metrics import CallbackOptions, Observation
from psycopg import AsyncConnection
from psycopg_pool import AsyncConnectionPool, PoolTimeout

from common.errors import ServiceError

POOL_NAME_ATTR = "db.client.connection.pool.name"
STATE_ATTR = "db.client.connection.state"


class DatabaseUnavailable(ServiceError):
    status_code = 503
    code = "database_unavailable"


class Database:
    def __init__(
        self, name: str, dsn: str | None = None, *, min_size: int = 1, max_size: int = 10
    ) -> None:
        self.name = name
        self.default_max = max_size
        self.pool = AsyncConnectionPool(
            dsn or os.getenv("DATABASE_URL", "postgresql://shop:shop@localhost:5432/shop"),
            min_size=min_size,
            max_size=max_size,
            timeout=float(os.getenv("DB_POOL_TIMEOUT_S", "2")),
            # Autocommit: one statement is one transaction; multi-statement work uses
            # `async with conn.transaction()` explicitly.
            kwargs={"autocommit": True},
            open=False,
        )
        self._attrs = {POOL_NAME_ATTR: name}
        meter = metrics.get_meter("common.db")
        self._wait_time = meter.create_histogram(
            "db.client.connection.wait_time",
            unit="s",
            description="Time it took to obtain an open connection from the pool",
            explicit_bucket_boundaries_advisory=[0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2],
        )
        self._timeouts = meter.create_counter(
            "db.client.connection.timeouts",
            unit="{timeout}",
            description="Connection requests that timed out waiting for the pool",
        )
        meter.create_observable_up_down_counter(
            "db.client.connection.count",
            callbacks=[self._observe_count],
            unit="{connection}",
            description="Connections currently in the pool, by state",
        )
        meter.create_observable_up_down_counter(
            "db.client.connection.max",
            callbacks=[self._observe_max],
            unit="{connection}",
            description="The maximum number of open connections allowed",
        )
        meter.create_observable_up_down_counter(
            "db.client.connection.pending_requests",
            callbacks=[self._observe_pending],
            unit="{request}",
            description="Requests waiting for an open connection",
        )

    async def open(self) -> None:
        # wait=False: the service starts even if PostgreSQL is still booting; /ready reports it.
        await self.pool.open(wait=False)

    async def close(self) -> None:
        await self.pool.close()

    async def resize(self, max_size: int) -> None:
        await self.pool.resize(min_size=min(1, max_size), max_size=max_size)

    @asynccontextmanager
    async def connection(self) -> AsyncIterator[AsyncConnection]:
        started = time.perf_counter()
        try:
            async with self.pool.connection() as conn:
                self._wait_time.record(time.perf_counter() - started, self._attrs)
                yield conn
        except PoolTimeout:
            self._timeouts.add(1, self._attrs)
            raise DatabaseUnavailable(
                f"timed out after {self.pool.timeout:.0f}s waiting for a database connection"
            ) from None

    async def ping(self) -> None:
        async with self.connection() as conn:
            await conn.execute("SELECT 1")

    # --- metric callbacks --------------------------------------------------------------------

    def _observe_count(self, _: CallbackOptions):
        stats = self.pool.get_stats()
        size, idle = stats.get("pool_size", 0), stats.get("pool_available", 0)
        yield Observation(size - idle, {**self._attrs, STATE_ATTR: "used"})
        yield Observation(idle, {**self._attrs, STATE_ATTR: "idle"})

    def _observe_max(self, _: CallbackOptions):
        yield Observation(self.pool.max_size, self._attrs)

    def _observe_pending(self, _: CallbackOptions):
        yield Observation(self.pool.get_stats().get("requests_waiting", 0), self._attrs)
