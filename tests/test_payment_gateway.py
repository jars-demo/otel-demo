"""payment-service rules and failure telemetry; api-gateway routing, faults and trace header."""

import httpx
import pytest
from conftest import FakeDatabase, mock_client
from fastapi.testclient import TestClient
from opentelemetry.trace import StatusCode

from gateway.main import create_app as create_gateway
from payment.main import APPROVAL_LIMIT_CENTS, decide
from payment.main import create_app as create_payment

PAYMENT = {"order_id": "ord_1", "user_id": "user-1", "amount_cents": 12_900}


def test_approval_rule():
    assert decide(APPROVAL_LIMIT_CENTS) == "authorized"
    assert decide(APPROVAL_LIMIT_CENTS + 1) == "declined"


def test_payment_is_recorded_without_card_details():
    db = FakeDatabase()
    with TestClient(create_payment(db)) as client:
        response = client.post("/payments", json=PAYMENT)
    assert response.status_code == 201
    assert response.json()["status"] == "authorized"
    (query, params) = db.statements[0]
    assert query.startswith("INSERT INTO payments")
    assert params[1:] == ("ord_1", "authorized", 12_900, "USD")


def test_provider_timeout_records_exception(spans, log_records, monkeypatch):
    monkeypatch.setattr("payment.main.PROVIDER_TIMEOUT_MS", 1)
    db = FakeDatabase()
    with TestClient(create_payment(db)) as client:
        client.put("/internal/faults", json={"fail_payments": True})
        response = client.post("/payments", json=PAYMENT)
    assert response.status_code == 503
    assert response.json()["error"] == "payment_provider_timeout"
    provider = next(s for s in spans.get_finished_spans() if s.name == "payment.provider.authorize")
    assert provider.status.status_code == StatusCode.ERROR
    (event,) = [e for e in provider.events if e.name == "exception"]
    assert event.attributes["exception.type"].endswith("PaymentProviderTimeout")
    # The ERROR log carries the trace context of the request that failed.
    errors = [
        r.log_record
        for r in log_records.get_finished_logs()
        if r.log_record.severity_text == "ERROR"
    ]
    assert errors and errors[0].trace_id == provider.context.trace_id
    assert db.statements[0][1][2] == "failed"


def gateway(orders_handler, inventory_handler=None) -> TestClient:
    def inventory(request):
        return httpx.Response(200, json=[{"id": "prod-001"}])

    return TestClient(
        create_gateway(
            orders=mock_client("http://orders", orders_handler),
            inventory=mock_client("http://inventory", inventory_handler or inventory),
        )
    )


CART = {"user_id": "user-1", "items": [{"product_id": "prod-001", "quantity": 1}]}


def test_gateway_returns_trace_id_header(spans):
    with gateway(lambda r: httpx.Response(201, json={"status": "completed"})) as client:
        response = client.post("/api/checkout", json=CART)
    assert response.status_code == 201
    server = next(s for s in spans.get_finished_spans() if s.name == "POST /api/checkout")
    assert response.headers["X-Trace-Id"] == format(server.context.trace_id, "032x")


@pytest.mark.parametrize("status", [402, 409, 422])
def test_gateway_passes_business_outcomes_through(status):
    with gateway(lambda r: httpx.Response(status, json={"error": "x"})) as client:
        assert client.post("/api/checkout", json=CART).status_code == status


def test_gateway_maps_downstream_failure_to_502():
    def orders(request):
        return httpx.Response(502, json={"message": "payment-service returned 503"})

    with gateway(orders) as client:
        response = client.post("/api/checkout", json=CART)
    assert response.status_code == 502
    assert "order-service returned 502" in response.json()["message"]


def test_gateway_error_rate_fault_is_deterministic():
    with gateway(lambda r: httpx.Response(200, json=[])) as client:
        client.put("/internal/faults", json={"error_rate_percent": 25})
        codes = [client.get("/api/products").status_code for _ in range(8)]
    assert codes == [200, 200, 200, 503, 200, 200, 200, 503]


def test_gateway_validates_input():
    with gateway(lambda r: httpx.Response(201, json={})) as client:
        assert client.post("/api/checkout", json={"user_id": "u", "items": []}).status_code == 422
        assert client.put("/internal/faults", json={"error_rate_percent": 90}).status_code == 422
