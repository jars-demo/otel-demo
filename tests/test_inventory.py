"""inventory-service: catalog, atomic reservations, faults, and the spans they produce."""

import pytest
from fakeredis import FakeAsyncRedis
from fastapi.testclient import TestClient
from opentelemetry.trace import StatusCode

from inventory.main import create_app
from inventory.store import INITIAL_STOCK

LINE = {"product_id": "prod-001", "quantity": 2}


@pytest.fixture
def client():
    with TestClient(create_app(FakeAsyncRedis())) as test_client:
        yield test_client


def stock(client, product_id="prod-001") -> int:
    return client.get(f"/products/{product_id}").json()["stock"]


def test_catalog_is_seeded(client):
    products = client.get("/products").json()
    assert len(products) == 8
    assert {p["id"] for p in products} >= {"prod-001", "prod-008"}
    assert all(p["stock"] == INITIAL_STOCK for p in products)


def test_lookup_by_ids_skips_unknown(client):
    products = client.get("/products", params={"ids": "prod-002,prod-999"}).json()
    assert [p["id"] for p in products] == ["prod-002"]
    assert client.get("/products/prod-999").status_code == 404


def test_reserve_and_release(client):
    response = client.post("/reservations", json={"order_id": "o1", "items": [LINE]})
    assert response.status_code == 201
    assert stock(client) == INITIAL_STOCK - 2
    assert client.post("/reservations/o1/release").json()["released_lines"] == 1
    assert stock(client) == INITIAL_STOCK


def test_reserve_is_idempotent(client):
    body = {"order_id": "o2", "items": [LINE]}
    client.post("/reservations", json=body)
    client.post("/reservations", json=body)  # a retry after a timeout
    assert stock(client) == INITIAL_STOCK - 2


def test_out_of_stock_reserves_nothing_and_is_not_an_error(spans):
    redis = FakeAsyncRedis()
    with TestClient(create_app(redis)) as client:
        client.portal.call(redis.set, "stock:prod-004", 1)
        spans.clear()
        items = [
            {"product_id": "prod-001", "quantity": 1},
            {"product_id": "prod-004", "quantity": 2},
        ]
        response = client.post("/reservations", json={"order_id": "o5", "items": items})
        assert response.status_code == 409
        assert stock(client, "prod-001") == INITIAL_STOCK  # no partial reservation
    reserve = next(s for s in spans.get_finished_spans() if s.name == "inventory.reserve")
    assert reserve.status.status_code != StatusCode.ERROR
    assert reserve.attributes["app.reservation.outcome"] == "insufficient_stock"


def test_reserve_span_has_redis_child(client, spans):
    client.post("/reservations", json={"order_id": "o6", "items": [LINE]})
    finished = spans.get_finished_spans()
    reserve = next(s for s in finished if s.name == "inventory.reserve")
    redis_spans = [s for s in finished if s.attributes.get("db.system.name") == "redis"]
    assert any(s.parent.span_id == reserve.context.span_id for s in redis_spans)
    assert reserve.attributes["app.order.id"] == "o6"


def test_error_fault_fails_every_nth_reservation(client, spans):
    assert client.put("/internal/faults", json={"error_every_n": 3}).status_code == 200
    codes = [
        client.post("/reservations", json={"order_id": f"f{i}", "items": [LINE]}).status_code
        for i in range(6)
    ]
    assert codes == [201, 201, 500, 201, 201, 500]
    failed = [s for s in spans.get_finished_spans() if s.name == "inventory.reserve"]
    errors = [s for s in failed if s.status.status_code == StatusCode.ERROR]
    assert len(errors) == 2
    assert errors[0].events[0].name == "exception"


def test_faults_are_bounded_and_resettable(client):
    assert client.put("/internal/faults", json={"latency_ms": 99_999}).status_code == 422
    assert client.put("/internal/faults", json={"error_every_n": -1}).status_code == 422
    client.put("/internal/faults", json={"latency_ms": 10})
    assert client.post("/internal/faults/reset").json() == {"error_every_n": 0, "latency_ms": 0}


def test_health_and_ready(client):
    assert client.get("/health").json()["status"] == "ok"
    assert client.get("/ready").json() == {"status": "ready", "checks": {"redis": "ok"}}


def test_health_endpoints_are_not_traced(client, spans):
    client.get("/health")
    client.get("/internal/faults")
    assert not [s for s in spans.get_finished_spans() if s.kind.name == "SERVER"]
