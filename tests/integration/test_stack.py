"""End-to-end checks against the running lab (`docker compose up`). Run with:

    uv run pytest -m integration

They make real requests and poll the real backends, so they assert outcomes (a trace exists and
contains these services) rather than exact timings or span counts.
"""

from __future__ import annotations

import os
import time

import httpx
import pytest

pytestmark = pytest.mark.integration

GATEWAY = os.getenv("GATEWAY_URL", "http://localhost:8400")
LAB = os.getenv("LAB_URL", "http://localhost:8410")
CART = {"user_id": "user-it", "items": [{"product_id": "prod-006", "quantity": 1}]}


APP_SERVICES = {"api-gateway", "order-service", "inventory-service", "payment-service"}


def complete_trace(lab: httpx.Client, trace_id: str) -> dict:
    """Spans arrive in batches per service; wait until every service's spans are in Tempo."""

    def fetch():
        response = lab.get(f"/lab/traces/{trace_id}")
        if response.status_code != 200:
            return None
        trace = response.json()
        return trace if set(trace["services"]) >= APP_SERVICES else None

    return wait_for(fetch)


def wait_for(fetch, timeout_s: float = 60, interval_s: float = 2):
    """Poll until fetch() returns something truthy. Telemetry is batched, so it arrives late."""
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        result = fetch()
        if result:
            return result
        time.sleep(interval_s)
    raise AssertionError(f"timed out after {timeout_s}s")


@pytest.fixture(scope="module")
def lab():
    try:
        status = httpx.get(f"{LAB}/lab/status", timeout=5).json()
    except httpx.HTTPError:
        pytest.skip("the lab is not running (docker compose up -d --wait)")
    down = [name for name, state in status["components"].items() if state != "up"]
    assert not down, f"components not up: {down}"
    httpx.post(f"{LAB}/lab/faults/reset", timeout=10)
    return httpx.Client(base_url=LAB, timeout=15)


@pytest.fixture(scope="module")
def checkout(lab):
    response = httpx.post(f"{GATEWAY}/api/checkout", json=CART, timeout=15)
    assert response.status_code == 201, response.text
    return response


def test_checkout_completes(checkout):
    body = checkout.json()
    assert body["status"] == "completed"
    assert len(checkout.headers["X-Trace-Id"]) == 32


def test_trace_spans_every_service(lab, checkout):
    trace = complete_trace(lab, checkout.headers["X-Trace-Id"])
    assert trace["root_service"] == "api-gateway"
    names = {s["name"] for s in trace["spans"]}
    assert {"checkout", "inventory.reserve", "payment.process"} <= names
    db_systems = {s["attributes"].get("db.system.name") for s in trace["spans"]}
    assert {"redis", "postgresql"} <= db_systems
    assert trace["status"] == "ok"


def test_logs_are_correlated_with_the_trace(lab, checkout):
    trace_id = checkout.headers["X-Trace-Id"]
    logs = wait_for(lambda: lab.get("/lab/logs", params={"trace_id": trace_id}).json())
    assert all(entry["trace_id"] == trace_id for entry in logs)
    assert "checkout completed" in {entry["message"] for entry in logs}


def test_metrics_reach_prometheus(lab, checkout):
    metrics = wait_for(
        lambda: (m := lab.get("/lab/metrics/services").json())["api-gateway"]["rps"] and m
    )
    assert metrics["order-service"]["p95_ms"] is not None


def test_fault_changes_behaviour_and_resets(lab):
    lab.put("/lab/faults", json={"changes": {"payment.fail_payments": True}})
    try:
        response = httpx.post(f"{GATEWAY}/api/checkout", json=CART, timeout=15)
        assert response.status_code == 502
        assert "payment" in response.json()["message"]
    finally:
        faults = lab.post("/lab/faults/reset").json()
    assert not any(f["value"] for f in faults)
    assert httpx.post(f"{GATEWAY}/api/checkout", json=CART, timeout=15).status_code == 201


def test_redis_latency_shows_up_in_the_redis_span(lab):
    lab.put("/lab/faults", json={"changes": {"redis.latency_ms": 400}})
    try:
        response = httpx.post(f"{GATEWAY}/api/checkout", json=CART, timeout=15)
    finally:
        lab.post("/lab/faults/reset")
    trace = complete_trace(lab, response.headers["X-Trace-Id"])
    redis_spans = [s for s in trace["spans"] if s["attributes"].get("db.system.name") == "redis"]
    assert redis_spans and min(s["duration_ms"] for s in redis_spans) >= 400
    bottleneck = next(s for s in trace["spans"] if s["span_id"] == trace["bottleneck_span_id"])
    assert bottleneck["attributes"].get("db.system.name") == "redis"
