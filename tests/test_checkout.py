"""order-service checkout workflow, with inventory and payment replaced by httpx mock transports.

The mocks see real outgoing requests, so these tests also prove context propagation: every call
carries a W3C traceparent header from the current trace.
"""

import httpx
import pytest
from conftest import FakeDatabase, metric_points, mock_client
from fastapi.testclient import TestClient
from opentelemetry.trace import StatusCode

from orders.main import FAULT_POOL_MAX, POOL_MAX, create_app

CART = {"user_id": "user-123", "items": [{"product_id": "prod-001", "quantity": 2}]}
PRICES = [{"id": "prod-001", "price_cents": 8900}]


class Downstream:
    """Records requests and answers like inventory-service and payment-service."""

    def __init__(self, reserve_status=201, payment_status=201, payment_result="authorized"):
        self.reserve_status = reserve_status
        self.payment_status = payment_status
        self.payment_result = payment_result
        self.requests: list[httpx.Request] = []

    def inventory(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.url.path == "/products":
            return httpx.Response(200, json=PRICES)
        if request.url.path == "/reservations":
            return httpx.Response(self.reserve_status, json={"detail": "insufficient stock"})
        return httpx.Response(200, json={"released_lines": 1})  # release

    def payment(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.payment_status >= 500:
            return httpx.Response(self.payment_status, json={"message": "provider timeout"})
        return httpx.Response(201, json={"payment_id": "pay_1", "status": self.payment_result})

    def paths(self) -> list[str]:
        return [f"{r.method} {r.url.path}" for r in self.requests]


def make_client(downstream: Downstream, db: FakeDatabase | None = None) -> TestClient:
    app = create_app(
        db=db or FakeDatabase(),
        inventory=mock_client("http://inventory", downstream.inventory),
        payment=mock_client("http://payment", downstream.payment),
    )
    return TestClient(app)


def test_checkout_happy_path(spans):
    downstream, db = Downstream(), FakeDatabase()
    with make_client(downstream, db) as client:
        response = client.post("/checkout", json=CART)
    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "completed"
    assert body["total_cents"] == 17_800
    assert downstream.paths() == ["GET /products", "POST /reservations", "POST /payments"]
    assert db.statuses() == ["completed"]


def test_checkout_spans_follow_the_workflow(spans):
    with make_client(Downstream()) as client:
        client.post("/checkout", json=CART)
    names = [s.name for s in spans.get_finished_spans()]
    for step in (
        "checkout",
        "order.validate",
        "order.create",
        "order.reserve_inventory",
        "order.charge_payment",
        "order.complete",
    ):
        assert step in names
    checkout = next(s for s in spans.get_finished_spans() if s.name == "checkout")
    assert checkout.attributes["user.id"] == "user-123"
    assert checkout.attributes["app.order.id"].startswith("ord_")


def test_calls_carry_traceparent(spans):
    downstream = Downstream()
    with make_client(downstream) as client:
        client.post("/checkout", json=CART)
    checkout = next(s for s in spans.get_finished_spans() if s.name == "checkout")
    trace_id = format(checkout.context.trace_id, "032x")
    for request in downstream.requests:
        header = request.headers["traceparent"]
        assert header.split("-")[1] == trace_id


def test_out_of_stock_is_409_and_not_an_error(spans):
    db = FakeDatabase()
    with make_client(Downstream(reserve_status=409), db) as client:
        response = client.post("/checkout", json=CART)
    assert response.status_code == 409
    assert response.json()["error"] == "out_of_stock"
    assert db.statuses() == ["failed"]
    checkout = next(s for s in spans.get_finished_spans() if s.name == "checkout")
    assert checkout.status.status_code != StatusCode.ERROR
    assert checkout.attributes["app.checkout.outcome"] == "out_of_stock"


def test_declined_payment_releases_stock():
    downstream, db = Downstream(payment_result="declined"), FakeDatabase()
    with make_client(downstream, db) as client:
        response = client.post("/checkout", json=CART)
    assert response.status_code == 402
    assert downstream.paths()[-1].endswith("/release")
    assert db.statuses() == ["failed"]


def test_payment_failure_is_502_with_error_spans_and_release(spans):
    downstream, db = Downstream(payment_status=503), FakeDatabase()
    with make_client(downstream, db) as client:
        response = client.post("/checkout", json=CART)
    assert response.status_code == 502
    assert "payment-service returned 503" in response.json()["message"]
    assert downstream.paths()[-1].endswith("/release")
    charge = next(s for s in spans.get_finished_spans() if s.name == "order.charge_payment")
    assert charge.status.status_code == StatusCode.ERROR
    assert any(e.name == "exception" for e in charge.events)


def test_checkout_metric_counts_outcomes():
    def total(outcome: str) -> int:
        return sum(
            p.value
            for p in metric_points("orders.checkouts")
            if p.attributes.get("app.checkout.outcome") == outcome
        )

    before = total("completed")
    with make_client(Downstream()) as client:
        client.post("/checkout", json=CART)
    assert total("completed") == before + 1


def test_unknown_product_is_422():
    downstream = Downstream()
    with make_client(downstream) as client:
        cart = {"user_id": "u", "items": [{"product_id": "prod-404", "quantity": 1}]}
        response = client.post("/checkout", json=cart)
    assert response.status_code == 422
    assert downstream.paths() == ["GET /products"]


@pytest.mark.parametrize("quantity", [0, 21])
def test_quantity_is_bounded(quantity):
    with make_client(Downstream()) as client:
        cart = {"user_id": "u", "items": [{"product_id": "prod-001", "quantity": quantity}]}
        assert client.post("/checkout", json=cart).status_code == 422


def test_pool_fault_shrinks_and_restores_the_pool():
    db = FakeDatabase()
    with make_client(Downstream(), db) as client:
        client.put("/internal/faults", json={"hold_connection_during_checkout": True})
        assert db.max_size == FAULT_POOL_MAX
        assert client.post("/checkout", json=CART).status_code == 201  # still works, slowly
        client.post("/internal/faults/reset")
        assert db.max_size == POOL_MAX
