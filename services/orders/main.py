"""order-service: creates orders and runs the checkout workflow (inventory, then payment)."""

from __future__ import annotations

import os
from contextlib import asynccontextmanager

import httpx
from fastapi import HTTPException

from common.app import create_service_app
from common.db import Database
from common.faults import FaultState, fault_router
from common.http import service_client
from orders import checkout as workflow
from orders import repository
from orders.checkout import Deps, OrderFaults, OrderRequest

SERVICE_NAME = "order-service"
VERSION = "1.0.0"

POOL_MAX = 10
# INC-999 shrinks the pool so the held-connection bug shows up at lab traffic levels.
FAULT_POOL_MAX = 2


def create_app(
    db: Database | None = None,
    inventory: httpx.AsyncClient | None = None,
    payment: httpx.AsyncClient | None = None,
):
    database = db or Database("order-db", max_size=POOL_MAX)

    async def apply_faults(values: OrderFaults) -> None:
        await database.resize(
            FAULT_POOL_MAX if values.hold_connection_during_checkout else POOL_MAX
        )

    deps = Deps(
        db=database,
        # Generous timeouts: a slow dependency should show up as latency in the trace,
        # not be hidden behind an early timeout.
        inventory=inventory
        or service_client(os.getenv("INVENTORY_URL", "http://localhost:8003"), timeout_s=6),
        payment=payment
        or service_client(os.getenv("PAYMENT_URL", "http://localhost:8004"), timeout_s=6),
        faults=FaultState(OrderFaults, on_change=apply_faults),
    )

    @asynccontextmanager
    async def lifespan(app):
        await database.open()
        yield
        await database.close()
        await deps.inventory.aclose()
        await deps.payment.aclose()

    app = create_service_app(
        title=SERVICE_NAME,
        version=VERSION,
        lifespan=lifespan,
        ready_checks={"postgres": database.ping},
    )
    app.include_router(fault_router(deps.faults))
    app.state.deps = deps

    @app.post("/orders", status_code=201)
    async def create_order(body: OrderRequest):
        """Create a pending order without reserving stock or taking payment."""
        async with database.connection() as conn:
            order = await workflow.create_order(deps, conn, body)
        return {
            "order_id": order["order_id"],
            "status": "pending",
            "total_cents": order["total_cents"],
        }

    @app.post("/checkout", status_code=201)
    async def checkout(body: OrderRequest):
        return await workflow.checkout(deps, body)

    @app.get("/orders/{order_id}")
    async def get_order(order_id: str):
        async with database.connection() as conn:
            order = await repository.get_order(conn, order_id)
        if order is None:
            raise HTTPException(404, f"unknown order {order_id}")
        return order

    return app


app = create_app()
