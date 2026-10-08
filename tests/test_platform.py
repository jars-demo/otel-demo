"""Shared plumbing: resource attributes, JSON logs, lab fault validation, incident definitions."""

import json
import logging
from pathlib import Path

import httpx
import pytest
from opentelemetry import trace

from common.logs import JsonFormatter
from common.telemetry import DURATION_BUCKETS_S, build_resource
from lab.faults import CATALOG, FaultController, FaultError
from lab.incidents import load_incidents

ROOT = Path(__file__).resolve().parent.parent


def test_resource_identifies_the_service(monkeypatch):
    monkeypatch.delenv("OTEL_RESOURCE_ATTRIBUTES", raising=False)
    attrs = build_resource("order-service", "1.2.3").attributes
    assert attrs["service.name"] == "order-service"
    assert attrs["service.version"] == "1.2.3"
    assert attrs["service.namespace"] == "otel-lab"
    assert attrs["deployment.environment.name"] == "demo"
    assert attrs["service.instance.id"]


def test_duration_buckets_are_sorted():
    assert sorted(DURATION_BUCKETS_S) == DURATION_BUCKETS_S


def format_record(**extra) -> dict:
    record = logging.LogRecord("orders", logging.ERROR, __file__, 1, "payment failed", None, None)
    for key, value in extra.items():
        setattr(record, key, value)
    return json.loads(JsonFormatter("order-service").format(record))


def test_json_log_carries_trace_context_inside_a_span():
    with trace.get_tracer("test").start_as_current_span("work") as span:
        entry = format_record(**{"app.order.id": "ord_1"})
    assert entry["trace_id"] == format(span.get_span_context().trace_id, "032x")
    assert entry["span_id"] == format(span.get_span_context().span_id, "016x")
    assert entry["severity"] == "ERROR"
    assert entry["service.name"] == "order-service"
    assert entry["app.order.id"] == "ord_1"


def test_json_log_outside_a_span_has_no_trace_fields():
    entry = format_record()
    assert "trace_id" not in entry
    assert "color_message" not in entry


# --- lab faults ---------------------------------------------------------------------------------


class FakeLabNetwork:
    def __init__(self):
        self.service_faults = {"payment-service": {"fail_payments": False}}
        self.toxics: list[dict] = []

    def handle(self, request: httpx.Request) -> httpx.Response:
        if request.url.host == "toxiproxy":
            if request.method == "POST":
                self.toxics.append(json.loads(request.content))
                return httpx.Response(200, json={})
            if request.method == "DELETE":
                return httpx.Response(204)
            return httpx.Response(200, json={"redis": {"toxics": self.toxics}, "postgres": {}})
        service = request.url.host
        if request.method == "PUT":
            self.service_faults[service] = json.loads(request.content)
        return httpx.Response(200, json=self.service_faults.get(service, {}))


@pytest.fixture
def controller():
    network = FakeLabNetwork()
    client = httpx.AsyncClient(transport=httpx.MockTransport(network.handle))
    urls = {name: f"http://{name}" for name in ("payment-service",)}
    return FaultController(client, urls, "http://toxiproxy"), network


@pytest.mark.parametrize(
    "changes",
    [
        {"redis.latency_ms": 99_999},
        {"redis.latency_ms": -1},
        {"payment.fail_payments": 1},
        {"inventory.error_every_n": True},
        {"no.such.fault": 1},
    ],
)
async def test_fault_values_are_validated(controller, changes):
    lab, _ = controller
    with pytest.raises(FaultError):
        await lab.apply(changes)


async def test_network_latency_is_an_upstream_toxic(controller):
    lab, network = controller
    await lab.apply({"redis.latency_ms": 1500})
    assert network.toxics == [
        {
            "name": "latency",
            "type": "latency",
            "stream": "upstream",
            "attributes": {"latency": 1500, "jitter": 0},
        }
    ]


async def test_service_fault_is_merged_and_sent(controller):
    lab, network = controller
    await lab.apply({"payment.fail_payments": True})
    assert network.service_faults["payment-service"] == {"fail_payments": True}


def test_every_fault_is_bounded():
    for fault in CATALOG:
        assert fault.kind in ("int", "bool")
        assert (fault.service and fault.field) or fault.proxy
        if fault.kind == "int":
            assert 0 < fault.max <= 5000


# --- incidents ----------------------------------------------------------------------------------


def test_incident_definitions_are_complete():
    incidents = load_incidents(ROOT / "incidents")
    assert set(incidents) == {"INC-001", "INC-002", "INC-003", "INC-004", "INC-005", "INC-999"}
    for incident in incidents.values():
        options = incident["question"]["options"]
        assert sum(o["correct"] for o in options) == 1, incident["id"]
        assert all(o["feedback"] for o in options)
        assert incident["trigger"]["faults"], incident["id"]
        assert all(step["title"] and step["task"] for step in incident["investigation"])
        answer = incident["answer"]
        for key in ("root_cause", "evidence", "remediation", "verification", "lesson"):
            assert answer[key], f"{incident['id']} answer.{key}"
