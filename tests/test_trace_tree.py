"""The Trace Explorer's math: self time, critical path, bottleneck, id decoding."""

import base64

from lab.traces import hex_id, to_tree

MS = 1_000_000


def span(span_id, parent, name, start_ms, end_ms, service="svc", status=None, events=()):
    raw = {
        "spanId": span_id,
        "name": name,
        "kind": "SPAN_KIND_INTERNAL",
        "startTimeUnixNano": str(start_ms * MS),
        "endTimeUnixNano": str(end_ms * MS),
        "attributes": [{"key": "app.order.id", "value": {"stringValue": "ord_1"}}],
        "events": list(events),
    }
    if parent:
        raw["parentSpanId"] = parent
    if status:
        raw["status"] = {"code": status, "message": "boom"}
    return raw


def otlp(spans, service="svc"):
    return {
        "trace": {
            "resourceSpans": [
                {
                    "resource": {
                        "attributes": [{"key": "service.name", "value": {"stringValue": service}}]
                    },
                    "scopeSpans": [{"spans": spans}],
                }
            ]
        }
    }


def by_name(tree):
    return {s["name"]: s for s in tree["spans"]}


def test_self_time_excludes_children():
    tree = to_tree(
        otlp(
            [
                span("a" * 16, None, "root", 0, 100),
                span("b" * 16, "a" * 16, "child-1", 10, 40),
                span("c" * 16, "a" * 16, "child-2", 30, 60),  # overlaps child-1
            ]
        )
    )
    spans = by_name(tree)
    assert spans["root"]["duration_ms"] == 100
    assert spans["root"]["self_ms"] == 50  # 100 minus the union [10, 60]
    assert spans["child-1"]["self_ms"] == 30


def test_bottleneck_is_the_critical_span_with_most_self_time():
    tree = to_tree(
        otlp(
            [
                span("a" * 16, None, "checkout", 0, 1600),
                span("b" * 16, "a" * 16, "order.validate", 0, 50),
                span("c" * 16, "a" * 16, "inventory.reserve", 60, 1580),
                span("d" * 16, "c" * 16, "EVALSHA", 70, 1570),
            ]
        )
    )
    spans = by_name(tree)
    assert tree["bottleneck_span_id"] == spans["EVALSHA"]["span_id"]
    assert all(spans[n]["critical"] for n in ("checkout", "inventory.reserve", "EVALSHA"))
    assert spans["order.validate"]["critical"]  # ran before the slow step, on the same path


def test_child_ending_after_parent_stays_on_critical_path():
    # A SERVER span can close a moment after the CLIENT span that called it.
    tree = to_tree(
        otlp(
            [
                span("a" * 16, None, "client", 0, 200),
                span("b" * 16, "a" * 16, "server", 1, 201),
            ]
        )
    )
    assert by_name(tree)["server"]["critical"]


def test_tree_order_depth_and_error_status():
    tree = to_tree(
        otlp(
            [
                span("b" * 16, "a" * 16, "child", 5, 10, status="STATUS_CODE_ERROR"),
                span("a" * 16, None, "root", 0, 20),
            ]
        )
    )
    assert [s["name"] for s in tree["spans"]] == ["root", "child"]
    assert [s["depth"] for s in tree["spans"]] == [0, 1]
    assert tree["status"] == "error"
    assert tree["spans"][1]["status_message"] == "boom"
    assert tree["spans"][1]["attributes"] == {"app.order.id": "ord_1"}


def test_events_are_decoded_with_offsets():
    event = {
        "name": "exception",
        "timeUnixNano": str(15 * MS),
        "attributes": [{"key": "exception.type", "value": {"stringValue": "TimeoutError"}}],
    }
    tree = to_tree(otlp([span("a" * 16, None, "root", 10, 20, events=[event])]))
    (decoded,) = tree["spans"][0]["events"]
    assert decoded == {
        "name": "exception",
        "attributes": {"exception.type": "TimeoutError"},
        "offset_ms": 5,
    }


def test_base64_ids_from_tempo_become_hex():
    raw = bytes.fromhex("3978166b85ddf5cf")
    assert hex_id(base64.b64encode(raw).decode(), 16) == "3978166b85ddf5cf"
    assert hex_id("ab" * 8, 16) == "ab" * 8
    assert hex_id(None, 16) is None


def test_missing_parent_marks_trace_incomplete():
    complete = to_tree(otlp([span("a" * 16, None, "root", 0, 10)]))
    partial = to_tree(otlp([span("b" * 16, "f" * 16, "orphan", 0, 10)]))
    assert complete["incomplete"] is False
    assert partial["incomplete"] is True
