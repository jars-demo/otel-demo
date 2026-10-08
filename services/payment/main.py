"""payment-service: authorizes payments against a sandboxed provider and records them."""

from __future__ import annotations

import asyncio
import random
import uuid
from contextlib import asynccontextmanager

from opentelemetry import metrics, trace
from pydantic import BaseModel, Field

from common.app import create_service_app
from common.db import Database
from common.errors import ServiceError
from common.faults import FaultState, fault_router

SERVICE_NAME = "payment-service"
VERSION = "1.0.0"

# Orders above this amount are declined: a business rule, so a declined payment is not an error.
APPROVAL_LIMIT_CENTS = 500_000
PROVIDER_TIMEOUT_MS = 800

tracer = trace.get_tracer("payment")
meter = metrics.get_meter("payment")
payments_processed = meter.create_counter(
    "payments.processed", unit="{payment}", description="Payment attempts, by outcome"
)


class PaymentFaults(BaseModel):
    fail_payments: bool = Field(False, description="The payment provider times out")


class PaymentRequest(BaseModel):
    order_id: str = Field(min_length=1, max_length=64)
    user_id: str = Field(min_length=1, max_length=64)
    amount_cents: int = Field(ge=1, le=10_000_000)
    currency: str = Field("USD", pattern="^[A-Z]{3}$")


class PaymentProviderTimeout(ServiceError):
    status_code = 503
    code = "payment_provider_timeout"


def decide(amount_cents: int) -> str:
    """The approval rule. Pure, so it is easy to test."""
    return "authorized" if amount_cents <= APPROVAL_LIMIT_CENTS else "declined"


def create_app(db: Database | None = None):
    faults = FaultState(PaymentFaults)
    database = db or Database("payment-db")

    @asynccontextmanager
    async def lifespan(app):
        await database.open()
        yield
        await database.close()

    app = create_service_app(
        title=SERVICE_NAME,
        version=VERSION,
        lifespan=lifespan,
        ready_checks={"postgres": database.ping},
    )
    app.include_router(fault_router(faults))
    app.state.faults = faults

    async def record(payment_id: str, body: PaymentRequest, status: str) -> None:
        async with database.connection() as conn:
            await conn.execute(
                "INSERT INTO payments (id, order_id, status, amount_cents, currency)"
                " VALUES (%s, %s, %s, %s, %s)",
                (payment_id, body.order_id, status, body.amount_cents, body.currency),
            )

    @app.post("/payments", status_code=201)
    async def process_payment(body: PaymentRequest):
        payment_id = f"pay_{uuid.uuid4().hex[:16]}"
        with tracer.start_as_current_span("payment.process") as span:
            span.set_attribute("app.order.id", body.order_id)
            span.set_attribute("app.payment.amount_cents", body.amount_cents)
            span.set_attribute("app.payment.currency", body.currency)

            with tracer.start_as_current_span("payment.provider.authorize") as provider:
                provider.set_attribute("app.payment.provider", "sandbox")
                if faults.current.fail_payments:
                    await asyncio.sleep(PROVIDER_TIMEOUT_MS / 1000)
                    payments_processed.add(1, {"app.payment.outcome": "failed"})
                    await record(payment_id, body, "failed")
                    # Raised inside both spans: each records the exception and is marked ERROR.
                    raise PaymentProviderTimeout(
                        f"payment provider timeout after {PROVIDER_TIMEOUT_MS} ms"
                    )
                await asyncio.sleep(random.uniform(0.015, 0.035))  # provider round trip
                status = decide(body.amount_cents)

            span.set_attribute("app.payment.outcome", status)
            payments_processed.add(1, {"app.payment.outcome": status})
            await record(payment_id, body, status)
        return {"payment_id": payment_id, "order_id": body.order_id, "status": status}

    return app


app = create_app()
