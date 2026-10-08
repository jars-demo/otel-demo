"""The checkout workflow: validate, create the order, reserve stock, take payment, complete.

Each step is a manual span named after the business operation. The HTTP, Redis and SQL spans the
instrumentation libraries create land underneath them, so a trace reads like the workflow:

    checkout
    ├── order.validate          price lookup from inventory-service
    ├── order.create            INSERT order + items
    ├── order.reserve_inventory POST inventory-service /reservations
    ├── order.charge_payment    POST payment-service /payments
    └── order.complete          UPDATE status
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass

import httpx
from fastapi import HTTPException
from opentelemetry import metrics, trace
from opentelemetry.semconv._incubating.attributes.user_attributes import USER_ID
from psycopg import AsyncConnection
from pydantic import BaseModel, Field

from common.db import Database
from common.errors import ServiceError
from common.faults import FaultState
from common.http import call
from orders import repository

log = logging.getLogger(__name__)
tracer = trace.get_tracer("orders")
meter = metrics.get_meter("orders")
orders_created = meter.create_counter(
    "orders.created", unit="{order}", description="Orders written to the database"
)
checkouts = meter.create_counter(
    "orders.checkouts", unit="{checkout}", description="Checkout attempts, by outcome"
)


class OrderFaults(BaseModel):
    hold_connection_during_checkout: bool = Field(
        False,
        description="Keep one database connection checked out for the whole checkout, "
        "including the calls to inventory and payment, with a pool of 2",
    )


class Line(BaseModel):
    product_id: str = Field(min_length=1, max_length=40)
    quantity: int = Field(ge=1, le=20)


class OrderRequest(BaseModel):
    user_id: str = Field(min_length=1, max_length=64)
    items: list[Line] = Field(min_length=1, max_length=10)


@dataclass
class Deps:
    db: Database
    inventory: httpx.AsyncClient
    payment: httpx.AsyncClient
    faults: FaultState[OrderFaults]


class CheckoutRejected(ServiceError):
    """The checkout cannot succeed for a business reason (stock, payment declined)."""


async def validate(deps: Deps, request: OrderRequest) -> tuple[list[dict], int]:
    """Merge duplicate lines, look up current prices, and compute the total."""
    with tracer.start_as_current_span("order.validate") as span:
        quantities: dict[str, int] = {}
        for line in request.items:
            quantities[line.product_id] = quantities.get(line.product_id, 0) + line.quantity
        response = await call(
            deps.inventory,
            "GET",
            "/products",
            dependency="inventory-service",
            retries=1,
            params={"ids": ",".join(quantities)},
        )
        prices = {p["id"]: p["price_cents"] for p in response.json()}
        unknown = sorted(set(quantities) - set(prices))
        if unknown:
            raise HTTPException(422, f"unknown products: {', '.join(unknown)}")
        lines = [
            {"product_id": pid, "quantity": qty, "unit_price_cents": prices[pid]}
            for pid, qty in quantities.items()
        ]
        total = sum(line["quantity"] * line["unit_price_cents"] for line in lines)
        span.set_attribute("app.order.line_count", len(lines))
        span.set_attribute("app.order.total_cents", total)
        return lines, total


async def create_order(deps: Deps, conn: AsyncConnection, request: OrderRequest) -> dict:
    lines, total = await validate(deps, request)
    order_id = f"ord_{uuid.uuid4().hex[:16]}"
    with tracer.start_as_current_span("order.create") as span:
        span.set_attribute("app.order.id", order_id)
        await repository.insert_order(conn, order_id, request.user_id, lines, total)
    orders_created.add(1)
    log.info("order created", extra={"app.order.id": order_id, "app.order.total_cents": total})
    return {"order_id": order_id, "total_cents": total, "lines": lines}


@asynccontextmanager
async def connection_for(
    deps: Deps, held: AsyncConnection | None
) -> AsyncIterator[AsyncConnection]:
    """Use the held connection if there is one, otherwise borrow one just for this step."""
    if held is not None:
        yield held
    else:
        async with deps.db.connection() as conn:
            yield conn


async def checkout(deps: Deps, request: OrderRequest) -> dict:
    rejected: CheckoutRejected | None = None
    with tracer.start_as_current_span("checkout") as span:
        span.set_attribute(USER_ID, request.user_id)
        try:
            if deps.faults.current.hold_connection_during_checkout:
                # The bug behind INC-999: one connection held across two network calls. With
                # a small pool, concurrent checkouts queue for a connection before any SQL runs.
                async with deps.db.connection() as held:
                    return await _checkout_steps(deps, request, held)
            return await _checkout_steps(deps, request, None)
        except CheckoutRejected as exc:
            # Out of stock or a declined payment is a business outcome: record it on the span
            # as an attribute, but leave the span status OK. Only failures are errors.
            span.set_attribute("app.checkout.outcome", exc.code)
            rejected = exc
    raise rejected


async def _checkout_steps(deps: Deps, request: OrderRequest, held: AsyncConnection | None) -> dict:
    async with connection_for(deps, held) as conn:
        order = await create_order(deps, conn, request)
    order_id = order["order_id"]
    trace.get_current_span().set_attribute("app.order.id", order_id)

    reserved = False
    try:
        with tracer.start_as_current_span("order.reserve_inventory"):
            response = await call(
                deps.inventory,
                "POST",
                "/reservations",
                dependency="inventory-service",
                retries=1,
                json={"order_id": order_id, "items": order["lines"]},
            )
        if response.status_code == 409:
            raise CheckoutRejected(response.json()["detail"], status_code=409, code="out_of_stock")
        reserved = True

        with tracer.start_as_current_span("order.charge_payment"):
            response = await call(
                deps.payment,
                "POST",
                "/payments",
                dependency="payment-service",
                json={
                    "order_id": order_id,
                    "user_id": request.user_id,
                    "amount_cents": order["total_cents"],
                },
            )
        payment = response.json()
        if payment["status"] != "authorized":
            raise CheckoutRejected("payment declined", status_code=402, code="payment_declined")
    except ServiceError as exc:
        if reserved:
            await _release(deps, order_id)
        async with connection_for(deps, held) as conn:
            await repository.set_status(conn, order_id, "failed", exc.message[:200])
        outcome = exc.code if isinstance(exc, CheckoutRejected) else "failed"
        checkouts.add(1, {"app.checkout.outcome": outcome})
        raise

    with tracer.start_as_current_span("order.complete"):
        async with connection_for(deps, held) as conn:
            await repository.set_status(conn, order_id, "completed")
    checkouts.add(1, {"app.checkout.outcome": "completed"})
    log.info("checkout completed", extra={"app.order.id": order_id})
    return {
        "order_id": order_id,
        "status": "completed",
        "total_cents": order["total_cents"],
        "payment_id": payment["payment_id"],
    }


async def _release(deps: Deps, order_id: str) -> None:
    """Compensation: give reserved stock back. Best effort; a failure here is logged, not raised."""
    try:
        await call(
            deps.inventory,
            "POST",
            f"/reservations/{order_id}/release",
            dependency="inventory-service",
        )
    except ServiceError:
        log.exception("could not release reservation", extra={"app.order.id": order_id})
