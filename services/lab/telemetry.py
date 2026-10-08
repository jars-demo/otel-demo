"""Read-only queries against Tempo, Prometheus and Loki for the web UI.

Every number the UI labels "live" comes through here, from the real backends. Nothing is
generated: when there is no traffic, the answer is "no data", not a made-up value.
"""

from __future__ import annotations

import os
import re
import time

import httpx

from lab.traces import to_tree

APP_SERVICES = ["api-gateway", "order-service", "inventory-service", "payment-service"]
DATA_STORES = ["redis", "postgres"]
SEVERITIES = ["DEBUG", "INFO", "WARN", "WARNING", "ERROR", "FATAL"]

# Health thresholds. A lab needs fixed, explainable rules; production would use SLOs.
SERVICE_P95_DEGRADED_MS, SERVICE_P95_UNHEALTHY_MS = 500, 2000
STORE_P95_DEGRADED_MS, STORE_P95_UNHEALTHY_MS = 100, 500
ERROR_DEGRADED, ERROR_UNHEALTHY = 0.01, 0.10

FIVE_XX = '{http_response_status_code=~"5.."}'
TRACE_ID = re.compile(r"^[0-9a-f]{32}$")
SERVICE_NAME = re.compile(r"^[a-z][a-z0-9-]{0,40}$")
WINDOW = re.compile(r"^\d{1,3}[smh]$")


class BackendError(RuntimeError):
    pass


class Telemetry:
    def __init__(self, http: httpx.AsyncClient) -> None:
        self.http = http
        self.tempo = os.getenv("TEMPO_URL", "http://localhost:3200")
        self.prometheus = os.getenv("PROMETHEUS_URL", "http://localhost:9090")
        self.loki = os.getenv("LOKI_URL", "http://localhost:3100")

    # --- Prometheus ----------------------------------------------------------------------------

    async def prom(self, query: str) -> list[dict]:
        try:
            response = await self.http.get(
                f"{self.prometheus}/api/v1/query", params={"query": query}, timeout=5
            )
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise BackendError(f"Prometheus query failed: {type(exc).__name__}") from exc
        return response.json()["data"]["result"]

    async def prom_range(self, query: str, minutes: int, step_s: int) -> list[dict]:
        end = time.time()
        try:
            response = await self.http.get(
                f"{self.prometheus}/api/v1/query_range",
                params={"query": query, "start": end - minutes * 60, "end": end, "step": step_s},
                timeout=8,
            )
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise BackendError(f"Prometheus query failed: {type(exc).__name__}") from exc
        return response.json()["data"]["result"]

    async def by_label(self, query: str, label: str) -> dict[str, float]:
        out = {}
        for row in await self.prom(query):
            value = float(row["value"][1])
            if value == value:  # drop NaN (no traffic in the window)
                out[row["metric"].get(label, "")] = value
        return out

    async def service_metrics(self, window: str = "1m") -> dict[str, dict]:
        """RED metrics per service from the HTTP server duration histogram."""
        assert WINDOW.match(window)
        metric = "http_server_request_duration_seconds"
        rate = f"sum by (service_name) (rate({metric}_count[{window}]))"
        errors = (
            f'sum by (service_name) (rate({metric}_count{{http_response_status_code=~"5.."}}'
            f"[{window}]))"
        )
        rps = await self.by_label(rate, "service_name")
        err = await self.by_label(errors, "service_name")
        quantiles = {}
        for q in (0.5, 0.95, 0.99):
            query = (
                f"histogram_quantile({q}, sum by (le, service_name) "
                f"(rate({metric}_bucket[{window}])))"
            )
            quantiles[q] = await self.by_label(query, "service_name")
        out = {}
        for service in APP_SERVICES:
            r = rps.get(service)
            ratio = (err.get(service, 0.0) / r) if r else None
            p95 = _ms(quantiles[0.95].get(service))
            out[service] = {
                "rps": _round(r),
                "error_ratio": _round(ratio, 4),
                "p50_ms": _ms(quantiles[0.5].get(service)),
                "p95_ms": p95,
                "p99_ms": _ms(quantiles[0.99].get(service)),
                "health": _health(p95, ratio, SERVICE_P95_DEGRADED_MS, SERVICE_P95_UNHEALTHY_MS),
            }
        return out

    async def gateway_snapshot(self, window: str = "30s") -> dict:
        metrics = await self.service_metrics(window)
        gateway = metrics["api-gateway"]
        return {
            "rps": gateway["rps"],
            "p95_ms": gateway["p95_ms"],
            "error_ratio": gateway["error_ratio"],
            "measured_at": time.time(),
        }

    async def service_map(self, window: str = "1m") -> dict:
        """Nodes and edges from Tempo's service-graph metrics, plus RED health per node."""
        assert WINDOW.match(window)
        services = await self.service_metrics(window)
        # Tempo writes service-graph series about every 15 s, so a 30 s window can hold a
        # single sample and rate() needs two. Edges always use at least one minute.
        window = "1m" if window == "30s" else window
        base = "traces_service_graph_request"
        edge_rate = await self.prom(f"sum by (client, server) (rate({base}_total[{window}]))")
        edge_failed = await self.prom(
            f"sum by (client, server) (rate({base}_failed_total[{window}]))"
        )
        edge_p95 = await self.prom(
            f"histogram_quantile(0.95, sum by (le, client, server) "
            f"(rate({base}_client_seconds_bucket[{window}])))"
        )
        failed = {
            (r["metric"]["client"], r["metric"]["server"]): float(r["value"][1])
            for r in edge_failed
        }
        p95 = {
            (r["metric"]["client"], r["metric"]["server"]): float(r["value"][1]) for r in edge_p95
        }
        known = set(APP_SERVICES) | set(DATA_STORES)
        edges = []
        for row in edge_rate:
            key = (row["metric"]["client"], row["metric"]["server"])
            if key[0] not in known or key[1] not in known:
                continue
            rate = float(row["value"][1])
            edge_p95_ms = _ms(p95.get(key))
            ratio = failed.get(key, 0.0) / rate if rate else None
            edges.append({
                "source": key[0], "target": key[1], "rps": _round(rate),
                "error_ratio": _round(ratio, 4), "p95_ms": edge_p95_ms,
            })  # fmt: skip
        nodes = [{"id": s, "type": "service", **services[s]} for s in APP_SERVICES]
        for store in DATA_STORES:
            incoming = [e for e in edges if e["target"] == store and e["rps"]]
            worst_p95 = max((e["p95_ms"] or 0 for e in incoming), default=None)
            worst_err = max((e["error_ratio"] or 0 for e in incoming), default=None)
            nodes.append({
                "id": store, "type": "datastore",
                "rps": _round(sum(e["rps"] or 0 for e in incoming)) if incoming else None,
                "p95_ms": worst_p95, "error_ratio": worst_err,
                "health": _health(
                    worst_p95, worst_err, STORE_P95_DEGRADED_MS, STORE_P95_UNHEALTHY_MS
                )
                if incoming else "idle",
            })  # fmt: skip
        return {"window": window, "nodes": nodes, "edges": edges}

    async def timeseries(self, minutes: int = 15) -> dict:
        minutes = max(5, min(minutes, 60))
        step = max(5, minutes * 60 // 120)
        metric = "http_server_request_duration_seconds"
        queries = {
            "rps": f"sum by (service_name) (rate({metric}_count[1m]))",
            "errors": f"sum by (service_name) (rate({metric}_count{FIVE_XX}[1m]))",
            "p95_ms": "1000 * histogram_quantile(0.95, sum by (le, service_name) "
            f"(rate({metric}_bucket[1m])))",
        }  # fmt: skip
        out: dict = {"step_s": step, "minutes": minutes, "series": {}}
        for name, query in queries.items():
            rows = await self.prom_range(query, minutes, step)
            out["series"][name] = {
                row["metric"].get("service_name", ""): [
                    [int(t), None if v in ("NaN", "+Inf") else round(float(v), 3)]
                    for t, v in row["values"]
                ]
                for row in rows
                if row["metric"].get("service_name") in APP_SERVICES
            }
        return out

    async def pool_metrics(self) -> dict:
        """Connection pool gauges. Pushed (OTLP) series have no staleness markers, so a replaced
        container's last values linger for five minutes; last_over_time([30s]) skips them."""
        rows = await self.prom(
            "max by (service_name, db_client_connection_state) "
            "(last_over_time(db_client_connection_count[30s]))"
        )
        out: dict[str, dict] = {}
        for row in rows:
            labels = row["metric"]
            out.setdefault(labels["service_name"], {})[labels["db_client_connection_state"]] = int(
                float(row["value"][1])
            )
        for name, query in {
            "max": "max by (service_name) (last_over_time(db_client_connection_max[30s]))",
            "pending": "max by (service_name) "
            "(last_over_time(db_client_connection_pending_requests[30s]))",
            "wait_p95_ms": "1000 * histogram_quantile(0.95, sum by (le, service_name) "
            "(rate(db_client_connection_wait_time_seconds_bucket[1m])))",
            "timeouts_per_s": "sum by (service_name) "
            "(rate(db_client_connection_timeouts_total[1m]))",
        }.items():
            for service, value in (await self.by_label(query, "service_name")).items():
                out.setdefault(service, {})[name] = round(value, 2)
        return out

    # --- Tempo ---------------------------------------------------------------------------------

    async def search_traces(
        self,
        service: str | None = None,
        errors_only: bool = False,
        min_duration_ms: int | None = None,
        operation: str | None = None,
        minutes: int = 15,
        limit: int = 20,
    ) -> list[dict]:
        root = ['resource.service.name = "api-gateway"', "kind = server"]
        if errors_only:
            root.append("status = error")
        if min_duration_ms:
            root.append(f"duration > {int(min_duration_ms)}ms")
        if operation:
            if operation not in ("checkout", "products", "orders"):
                raise ValueError("operation must be checkout, products or orders")
            root.append(f'name =~ "[A-Z]+ /api/{operation}.*"')
        query = "{ " + " && ".join(root) + " }"
        if service:
            if not SERVICE_NAME.match(service):
                raise ValueError("invalid service name")
            query += f' && {{ resource.service.name = "{service}" }}'
        query += " | select(span.http.response.status_code, status)"
        end = int(time.time())
        params = {
            "q": query,
            "limit": max(1, min(limit, 50)),
            "start": end - max(1, min(minutes, 180)) * 60,
            "end": end,
            "spss": 1,
        }
        try:
            response = await self.http.get(f"{self.tempo}/api/search", params=params, timeout=10)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise BackendError(f"Tempo search failed: {type(exc).__name__}") from exc
        results = []
        for trace in response.json().get("traces", []):
            status_code, status = None, "ok"
            for span_set in trace.get("spanSets", []) or [trace.get("spanSet", {})]:
                for span in span_set.get("spans", []):
                    attrs = {a["key"]: a.get("value", {}) for a in span.get("attributes", [])}
                    if "http.response.status_code" in attrs and status_code is None:
                        status_code = int(attrs["http.response.status_code"].get("intValue", 0))
                    if attrs.get("status", {}).get("stringValue") == "error":
                        status = "error"
            if status_code and status_code >= 500:
                status = "error"
            results.append({
                "trace_id": normalize_trace_id(trace["traceID"]),
                "root_name": trace.get("rootTraceName"),
                "root_service": trace.get("rootServiceName"),
                "start_unix_ms": int(trace["startTimeUnixNano"]) // 1_000_000,
                "duration_ms": trace.get("durationMs", 0),
                "http_status_code": status_code,
                "status": status,
            })  # fmt: skip
        results.sort(key=lambda t: t["start_unix_ms"], reverse=True)
        return results

    async def get_trace(self, trace_id: str) -> dict | None:
        trace_id = normalize_trace_id(trace_id)
        try:
            response = await self.http.get(f"{self.tempo}/api/v2/traces/{trace_id}", timeout=10)
        except httpx.HTTPError as exc:
            raise BackendError(f"Tempo query failed: {type(exc).__name__}") from exc
        if response.status_code == 404:
            return None
        response.raise_for_status()
        tree = to_tree(response.json())
        tree["trace_id"] = trace_id
        return tree

    # --- Loki ----------------------------------------------------------------------------------

    async def logs(
        self,
        service: str | None = None,
        severity: str | None = None,
        trace_id: str | None = None,
        search: str | None = None,
        minutes: int = 15,
        limit: int = 100,
    ) -> list[dict]:
        selector = '{service_namespace="otel-lab"'
        if service:
            if not SERVICE_NAME.match(service):
                raise ValueError("invalid service name")
            selector += f', service_name="{service}"'
        query = selector + "}"
        if severity:
            severity = severity.upper()
            if severity not in SEVERITIES:
                raise ValueError(f"severity must be one of {', '.join(SEVERITIES)}")
            query += f' | severity_text="{severity}"'
        if trace_id:
            trace_id = normalize_trace_id(trace_id)
            query += f' | trace_id="{trace_id}"'
        if search:
            # Line filter on the message, with LogQL string escaping.
            escaped = search[:100].replace("\\", "\\\\").replace('"', '\\"')
            query += f' |= "{escaped}"'
        end_ns = time.time_ns()
        params = {
            "query": query,
            "limit": max(1, min(limit, 500)),
            "start": end_ns - max(1, min(minutes, 180)) * 60 * 1_000_000_000,
            "end": end_ns,
            "direction": "backward",
        }
        try:
            response = await self.http.get(
                f"{self.loki}/loki/api/v1/query_range", params=params, timeout=10
            )
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise BackendError(f"Loki query failed: {type(exc).__name__}") from exc
        entries = []
        for stream in response.json()["data"]["result"]:
            labels = stream["stream"]
            # Loki stores attribute names with dots replaced by underscores (app.order.id ->
            # app_order_id). Show them as stored rather than guess the dots back.
            extra = {
                k: v
                for k, v in labels.items()
                if k.startswith(("app_", "error_", "http_response", "url_", "peer_", "lab_"))
            }
            for ts, line in stream["values"]:
                entries.append({
                    "timestamp_ns": int(ts),
                    "severity": severity_of(labels),
                    "service": labels.get("service_name"),
                    "message": line,
                    "trace_id": labels.get("trace_id") or None,
                    "span_id": labels.get("span_id") or None,
                    "logger": labels.get("scope_name"),
                    "attributes": extra,
                })  # fmt: skip
        entries.sort(key=lambda e: e["timestamp_ns"], reverse=True)
        return entries[: params["limit"]]


def normalize_trace_id(value: str) -> str:
    """Trace ids are 32 hex characters. Tempo's search API drops leading zeros; put them back."""
    value = value.strip().lower().zfill(32)
    if not TRACE_ID.match(value):
        raise ValueError("trace id must be up to 32 hexadecimal characters")
    return value


def severity_of(labels: dict[str, str]) -> str:
    return labels.get("severity_text", labels.get("detected_level", "")).upper()


def _ms(seconds: float | None) -> float | None:
    if seconds is None or seconds != seconds or seconds == float("inf"):
        return None
    return round(seconds * 1000, 1)


def _round(value: float | None, digits: int = 2) -> float | None:
    return None if value is None else round(value, digits)


def _health(p95_ms, error_ratio, degraded_ms: float, unhealthy_ms: float) -> str:
    if p95_ms is None and error_ratio is None:
        return "idle"
    if (p95_ms or 0) >= unhealthy_ms or (error_ratio or 0) >= ERROR_UNHEALTHY:
        return "unhealthy"
    if (p95_ms or 0) >= degraded_ms or (error_ratio or 0) >= ERROR_DEGRADED:
        return "degraded"
    return "healthy"
