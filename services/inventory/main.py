"""inventory-service: the product catalog, stock levels and reservations, backed by Redis."""

from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import HTTPException, Query
from opentelemetry import metrics, trace
from pydantic import BaseModel, Field
from redis.asyncio import Redis

from common.app import create_service_app
from common.errors import ServiceError
from common.faults import FaultState, fault_router
from inventory.store import PRODUCT_IDS, InsufficientStock, InventoryStore

SERVICE_NAME = "inventory-service"
VERSION = "1.0.0"

tracer = trace.get_tracer("inventory")
meter = metrics.get_meter("inventory")
reservations = meter.create_counter(
    "inventory.reservations",
    unit="{reservation}",
    description="Reservation attempts, by outcome",
)


class InventoryFaults(BaseModel):
    error_every_n: int = Field(0, ge=0, le=10, description="Fail every n-th reservation")
    latency_ms: int = Field(0, ge=0, le=5000, description="Slow reservation code path")


class Line(BaseModel):
    product_id: str = Field(min_length=1, max_length=40)
    quantity: int = Field(ge=1, le=20)


class ReservationRequest(BaseModel):
    order_id: str = Field(min_length=1, max_length=64)
    items: list[Line] = Field(min_length=1, max_length=10)


class StockLedgerUnavailable(ServiceError):
    status_code = 500
    code = "stock_ledger_unavailable"


def create_app(redis: Redis | None = None):
    faults = FaultState(InventoryFaults)
    state: dict[str, InventoryStore] = {}

    @asynccontextmanager
    async def lifespan(app):
        client = redis or Redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379/0"))
        state["store"] = InventoryStore(client)
        await state["store"].seed()
        yield
        if redis is None:
            await client.aclose()

    async def redis_ping() -> None:
        await state["store"].redis.ping()

    app = create_service_app(
        title=SERVICE_NAME, version=VERSION, lifespan=lifespan, ready_checks={"redis": redis_ping}
    )
    app.include_router(fault_router(faults))
    app.state.faults = faults

    @app.get("/products")
    async def list_products(ids: str | None = Query(None, max_length=400)):
        wanted = [i for i in ids.split(",") if i] if ids else PRODUCT_IDS
        return [p.__dict__ for p in await state["store"].get_products(wanted)]

    @app.get("/products/{product_id}")
    async def get_product(product_id: str):
        found = await state["store"].get_products([product_id])
        if not found:
            raise HTTPException(404, f"unknown product {product_id}")
        return found[0].__dict__

    @app.post("/reservations", status_code=201)
    async def reserve(body: ReservationRequest):
        lines = [(line.product_id, line.quantity) for line in body.items]
        # A manual span for the business operation. The Redis span from the instrumentation
        # library becomes its child, so the trace shows the operation and what it waited on.
        with tracer.start_as_current_span("inventory.reserve") as span:
            span.set_attribute("app.order.id", body.order_id)
            span.set_attribute("app.order.line_count", len(lines))
            current = faults.current
            if current.latency_ms:
                await asyncio.sleep(current.latency_ms / 1000)
            if faults.every_nth("reserve_error", current.error_every_n):
                reservations.add(1, {"app.reservation.outcome": "error"})
                raise StockLedgerUnavailable("reservation failed: stock ledger unavailable")
            try:
                await state["store"].reserve(body.order_id, lines)
                outcome = "reserved"
            except InsufficientStock as exc:
                outcome, shortage = "insufficient_stock", str(exc)
            span.set_attribute("app.reservation.outcome", outcome)
            reservations.add(1, {"app.reservation.outcome": outcome})
        if outcome == "insufficient_stock":
            # Raised after the span has ended: running out of stock is a business outcome,
            # so the span keeps status OK. An exception escaping the span would mark it ERROR.
            raise HTTPException(409, shortage)
        return {"order_id": body.order_id, "status": "reserved"}

    @app.post("/reservations/{order_id}/release")
    async def release(order_id: str):
        with tracer.start_as_current_span("inventory.release") as span:
            span.set_attribute("app.order.id", order_id)
            released = await state["store"].release(order_id)
        return {"order_id": order_id, "released_lines": released}

    @app.post("/internal/restock")
    async def restock():
        await state["store"].seed(restock=True)
        return {"status": "restocked"}

    return app


app = create_app()
