"""api-gateway: the only service the browser talks to. Validates input and routes requests.

Every response carries an `X-Trace-Id` header: copy it into the Trace Explorer (or Grafana) to
open the exact trace of the request you just made.
"""

from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager

import httpx
from fastapi import Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from opentelemetry import trace
from pydantic import BaseModel, Field

from common.app import create_service_app
from common.errors import ServiceError
from common.faults import FaultState, fault_router
from common.http import call, service_client

SERVICE_NAME = "api-gateway"
VERSION = "1.0.0"

tracer = trace.get_tracer("gateway")


class GatewayFaults(BaseModel):
    latency_ms: int = Field(0, ge=0, le=5000, description="Delay every API request")
    error_rate_percent: int = Field(0, ge=0, le=50, description="Fail this share of API requests")


class Line(BaseModel):
    product_id: str = Field(min_length=1, max_length=40, examples=["prod-001"])
    quantity: int = Field(ge=1, le=20, examples=[2])


class CheckoutRequest(BaseModel):
    user_id: str = Field(min_length=1, max_length=64, examples=["user-123"])
    items: list[Line] = Field(min_length=1, max_length=10)


class GatewayOverloaded(ServiceError):
    status_code = 503
    code = "gateway_unavailable"


# Responses from downstream services the gateway passes on unchanged.
PASSTHROUGH = (400, 402, 404, 409, 422)


def create_app(orders: httpx.AsyncClient | None = None, inventory: httpx.AsyncClient | None = None):
    faults = FaultState(GatewayFaults)
    clients = {
        "orders": orders or service_client(os.getenv("ORDERS_URL", "http://localhost:8002"), 10),
        "inventory": inventory
        or service_client(os.getenv("INVENTORY_URL", "http://localhost:8003"), 10),
    }

    @asynccontextmanager
    async def lifespan(app):
        yield
        for client in clients.values():
            await client.aclose()

    app = create_service_app(title=SERVICE_NAME, version=VERSION, lifespan=lifespan)
    app.include_router(fault_router(faults))
    app.state.faults = faults
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            o for o in os.getenv("CORS_ORIGINS", "http://localhost:3400").split(",") if o
        ],
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
        expose_headers=["X-Trace-Id"],
    )

    @app.middleware("http")
    async def api_faults_and_trace_header(request: Request, call_next):
        # Runs inside the SERVER span the FastAPI instrumentation opened for this request.
        if request.url.path.startswith("/api/"):
            current = faults.current
            if current.latency_ms:
                await asyncio.sleep(current.latency_ms / 1000)
            if current.error_rate_percent and faults.every_nth(
                "api_error", round(100 / current.error_rate_percent)
            ):
                # Raised outside a route, so turn it into a response here.
                exc = GatewayOverloaded("upstream connection pool exhausted at the gateway")
                response = await _error_response(request, exc)
            else:
                response = await call_next(request)
        else:
            response = await call_next(request)
        span_context = trace.get_current_span().get_span_context()
        if span_context.is_valid:
            response.headers["X-Trace-Id"] = format(span_context.trace_id, "032x")
        return response

    async def forward(client: str, method: str, path: str, dependency: str, **kwargs):
        response = await call(
            clients[client], method, path, dependency=dependency, passthrough=PASSTHROUGH, **kwargs
        )
        return JSONResponse(response.json(), status_code=response.status_code)

    @app.get("/api/products")
    async def list_products():
        return await forward("inventory", "GET", "/products", "inventory-service")

    @app.get("/api/products/{product_id}")
    async def get_product(product_id: str):
        return await forward("inventory", "GET", f"/products/{product_id}", "inventory-service")

    @app.post("/api/orders", status_code=201)
    async def create_order(body: CheckoutRequest):
        return await forward("orders", "POST", "/orders", "order-service", json=body.model_dump())

    @app.get("/api/orders/{order_id}")
    async def get_order(order_id: str):
        return await forward("orders", "GET", f"/orders/{order_id}", "order-service")

    @app.post("/api/checkout", status_code=201)
    async def checkout(body: CheckoutRequest):
        """Validate, create an order, reserve stock, take payment, complete the order."""
        with tracer.start_as_current_span("checkout.request") as span:
            span.set_attribute("app.order.line_count", len(body.items))
            return await forward(
                "orders", "POST", "/checkout", "order-service", json=body.model_dump()
            )

    return app


async def _error_response(request: Request, exc: ServiceError) -> JSONResponse:
    with tracer.start_as_current_span("gateway.admission") as span:
        span.record_exception(exc)
        span.set_status(trace.StatusCode.ERROR, exc.message)
    handler = request.app.exception_handlers[ServiceError]
    return await handler(request, exc)


app = create_app()
