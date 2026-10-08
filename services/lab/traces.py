"""Turn a Tempo trace (OTLP JSON) into what the Trace Explorer draws: a span tree with timing.

For every span it computes:

    depth        nesting level, for indentation
    offset_ms    start relative to the trace start
    self_ms      time spent in the span itself, not covered by any child span
    critical     whether it is on the critical path (the chain of spans that decided the end time)

and for the whole trace, the `bottleneck`: the critical-path span with the most self time. In a
slow trace that is where to look first.
"""

from __future__ import annotations

import base64
import binascii
import re
from typing import Any

HEX = re.compile(r"^[0-9a-f]+$")

KINDS = {
    "SPAN_KIND_SERVER": "server",
    "SPAN_KIND_CLIENT": "client",
    "SPAN_KIND_INTERNAL": "internal",
    "SPAN_KIND_PRODUCER": "producer",
    "SPAN_KIND_CONSUMER": "consumer",
}
STATUSES = {"STATUS_CODE_ERROR": "error", "STATUS_CODE_OK": "ok"}


def hex_id(value: str | None, length: int) -> str | None:
    """Span and trace ids as lowercase hex. Tempo's v2 API returns them base64 encoded."""
    if not value:
        return None
    if len(value) == length and HEX.match(value):
        return value
    try:
        return base64.b64decode(value).hex()
    except (binascii.Error, ValueError):
        return value


def any_value(value: dict[str, Any]) -> Any:
    """Decode an OTLP AnyValue ({"stringValue": "x"}, {"intValue": "3"}, ...)."""
    if "stringValue" in value:
        return value["stringValue"]
    if "intValue" in value:
        return int(value["intValue"])
    if "doubleValue" in value:
        return float(value["doubleValue"])
    if "boolValue" in value:
        return bool(value["boolValue"])
    if "arrayValue" in value:
        return [any_value(v) for v in value["arrayValue"].get("values", [])]
    return None


def attributes(items: list[dict] | None) -> dict[str, Any]:
    return {item["key"]: any_value(item.get("value", {})) for item in items or []}


def to_tree(otlp: dict) -> dict:
    trace = otlp.get("trace", otlp)
    spans: list[dict] = []
    for resource_spans in trace.get("resourceSpans", []):
        resource = attributes(resource_spans.get("resource", {}).get("attributes"))
        for scope_spans in resource_spans.get("scopeSpans", []):
            for raw in scope_spans.get("spans", []):
                start, end = int(raw["startTimeUnixNano"]), int(raw["endTimeUnixNano"])
                status = raw.get("status", {})
                spans.append({
                    "span_id": hex_id(raw["spanId"], 16),
                    "parent_id": hex_id(raw.get("parentSpanId"), 16),
                    "name": raw["name"],
                    "service": resource.get("service.name", "unknown"),
                    "kind": KINDS.get(raw.get("kind", ""), "internal"),
                    "start_ns": start,
                    "end_ns": end,
                    "status": STATUSES.get(status.get("code", ""), "unset"),
                    "status_message": status.get("message"),
                    "attributes": attributes(raw.get("attributes")),
                    "events": [
                        {
                            "name": event["name"],
                            "time_ns": int(event["timeUnixNano"]),
                            "attributes": attributes(event.get("attributes")),
                        }
                        for event in raw.get("events", [])
                    ],
                    "resource": resource,
                })  # fmt: skip
    if not spans:
        raise ValueError("trace has no spans")

    by_id = {span["span_id"]: span for span in spans}
    children: dict[str | None, list[dict]] = {}
    for span in spans:
        parent = span["parent_id"] if span["parent_id"] in by_id else None
        children.setdefault(parent, []).append(span)
    for siblings in children.values():
        siblings.sort(key=lambda s: s["start_ns"])

    trace_start = min(s["start_ns"] for s in spans)
    trace_end = max(s["end_ns"] for s in spans)
    roots = children.get(None, [])

    for span in spans:
        span["self_ns"] = _self_time(span, children.get(span["span_id"], []))
        span["critical"] = False
    for root in roots:
        _mark_critical(root, children)

    ordered: list[dict] = []

    def walk(span: dict, depth: int) -> None:
        span["depth"] = depth
        ordered.append(span)
        for child in children.get(span["span_id"], []):
            walk(child, depth + 1)

    for root in roots:
        walk(root, 0)

    critical = [s for s in ordered if s["critical"]]
    bottleneck = max(critical or ordered, key=lambda s: s["self_ns"])
    root = roots[0] if roots else ordered[0]

    def public(span: dict) -> dict:
        out = {k: v for k, v in span.items() if not k.endswith("_ns")}
        out["offset_ms"] = round((span["start_ns"] - trace_start) / 1e6, 3)
        out["duration_ms"] = round((span["end_ns"] - span["start_ns"]) / 1e6, 3)
        out["self_ms"] = round(span["self_ns"] / 1e6, 3)
        out["events"] = [
            {
                "name": e["name"],
                "attributes": e["attributes"],
                "offset_ms": round((e["time_ns"] - trace_start) / 1e6, 3),
            }
            for e in span["events"]
        ]
        return out

    # A span whose parent is not in the trace means the parent's batch has not arrived yet
    # (each service exports on its own schedule). Tell the UI instead of guessing.
    orphans = sum(1 for span in spans if span["parent_id"] and span["parent_id"] not in by_id)

    return {
        "trace_id": otlp.get("traceID") or _trace_id(trace),
        "incomplete": orphans > 0,
        "root_name": root["name"],
        "root_service": root["service"],
        "start_unix_ms": trace_start // 1_000_000,
        "duration_ms": round((trace_end - trace_start) / 1e6, 3),
        "status": "error" if any(s["status"] == "error" for s in spans) else "ok",
        "http_status_code": root["attributes"].get("http.response.status_code"),
        "services": sorted({s["service"] for s in spans}),
        "span_count": len(spans),
        "bottleneck_span_id": bottleneck["span_id"],
        "spans": [public(s) for s in ordered],
    }


def _trace_id(trace: dict) -> str | None:
    for resource_spans in trace.get("resourceSpans", []):
        for scope_spans in resource_spans.get("scopeSpans", []):
            for raw in scope_spans.get("spans", []):
                return hex_id(raw.get("traceId"), 32)
    return None


def _self_time(span: dict, kids: list[dict]) -> int:
    """Span duration minus the union of its children's intervals (clipped to the span)."""
    start, end = span["start_ns"], span["end_ns"]
    covered, cursor = 0, start
    for kid in sorted(kids, key=lambda k: k["start_ns"]):
        k_start, k_end = max(kid["start_ns"], cursor), min(kid["end_ns"], end)
        if k_end > k_start:
            covered += k_end - k_start
            cursor = k_end
    return max(0, (end - start) - covered)


def _mark_critical(span: dict, children: dict[str | None, list[dict]]) -> None:
    """Walk back from the span's end: the child that finished last is on the critical path,
    then the child that finished before that one started, and so on.

    A child can end a hair after its parent (a SERVER span closes after the response is sent,
    while the CLIENT span closed when it arrived), so child end times are clamped to the parent's.
    """
    span["critical"] = True
    cursor = span["end_ns"]
    kids = children.get(span["span_id"], [])
    for kid in sorted(kids, key=lambda k: min(k["end_ns"], span["end_ns"]), reverse=True):
        if min(kid["end_ns"], span["end_ns"]) <= cursor:
            _mark_critical(kid, children)
            cursor = kid["start_ns"]
