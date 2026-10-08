"""lab-console: the control room. Not part of the system under observation.

It injects faults, runs incidents and load, and reads Tempo, Prometheus and Loki for the web UI.
It is deliberately not instrumented (OTEL_SDK_DISABLED=true in Docker), so its own requests never
show up in the traces and metrics you investigate.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from lab.faults import CATALOG, FaultController, FaultError
from lab.incidents import IncidentRunner, load_incidents
from lab.load import LoadGenerator, LoadRequest
from lab.telemetry import APP_SERVICES, BackendError, Telemetry

SERVICE_NAME = "lab-console"
VERSION = "1.0.0"


class FaultChanges(BaseModel):
    changes: dict[str, int | bool]


def create_app() -> FastAPI:
    state: dict = {}

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        http = httpx.AsyncClient()
        gateway = httpx.AsyncClient(
            base_url=os.getenv("GATEWAY_URL", "http://localhost:8400"), timeout=15
        )
        faults = FaultController.from_env(http)
        load = LoadGenerator(gateway)
        telemetry = Telemetry(http)
        incidents = load_incidents(os.getenv("INCIDENTS_DIR", "incidents"))
        state.update(
            http=http,
            gateway=gateway,
            faults=faults,
            load=load,
            telemetry=telemetry,
            incidents=IncidentRunner(incidents, faults, load, telemetry),
        )
        yield
        await state["incidents"].stop()
        await http.aclose()
        await gateway.aclose()

    app = FastAPI(title=SERVICE_NAME, version=VERSION, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            o for o in os.getenv("CORS_ORIGINS", "http://localhost:3400").split(",") if o
        ],
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Content-Type"],
    )

    @app.exception_handler(BackendError)
    async def backend_error(_: Request, exc: BackendError):
        return JSONResponse({"error": "backend_unavailable", "message": str(exc)}, status_code=503)

    @app.exception_handler(FaultError)
    async def fault_error(_: Request, exc: FaultError):
        return JSONResponse({"error": "invalid_fault", "message": str(exc)}, status_code=400)

    @app.exception_handler(ValueError)
    async def value_error(_: Request, exc: ValueError):
        return JSONResponse({"error": "invalid_request", "message": str(exc)}, status_code=400)

    @app.get("/health")
    async def health():
        return {"status": "ok", "service": SERVICE_NAME, "version": VERSION}

    # --- status ------------------------------------------------------------------------------

    @app.get("/lab/status")
    async def status():
        """Is every part of the lab up? Probes each service's /ready and each backend."""
        http: httpx.AsyncClient = state["http"]
        faults: FaultController = state["faults"]
        targets = {name: f"{url}/ready" for name, url in faults.service_urls.items()}
        targets |= {
            "otel-collector": os.getenv("COLLECTOR_HEALTH_URL", "http://localhost:13133/"),
            "tempo": f"{state['telemetry'].tempo}/ready",
            "prometheus": f"{state['telemetry'].prometheus}/-/ready",
            "loki": f"{state['telemetry'].loki}/ready",
            "toxiproxy": f"{faults.toxiproxy_url}/version",
        }
        components = {}
        for name, url in targets.items():
            try:
                response = await http.get(url, timeout=2)
                components[name] = "up" if response.status_code == 200 else "not_ready"
            except httpx.HTTPError:
                components[name] = "down"
        return {
            "components": components,
            "incident": state["incidents"].state(),
            "load": state["load"].status(),
        }

    # --- faults ------------------------------------------------------------------------------

    @app.get("/lab/faults")
    async def get_faults():
        values = await state["faults"].current()
        return [{**fault.__dict__, "value": values.get(fault.id)} for fault in CATALOG]

    @app.put("/lab/faults")
    async def put_faults(body: FaultChanges):
        await state["faults"].apply(body.changes)
        return await get_faults()

    @app.post("/lab/faults/reset")
    async def reset_faults():
        await state["faults"].reset()
        return await get_faults()

    # --- incidents ---------------------------------------------------------------------------

    @app.get("/lab/incidents")
    async def list_incidents():
        return [
            {"id": i["id"], "slug": i["slug"], "title": i["title"]}
            for i in state["incidents"].incidents.values()
        ]

    @app.get("/lab/incidents/active")
    async def active_incident():
        return state["incidents"].state()

    @app.post("/lab/incidents/{incident_id}/start")
    async def start_incident(incident_id: str):
        if incident_id not in state["incidents"].incidents:
            raise HTTPException(404, f"unknown incident {incident_id}")
        return await state["incidents"].start(incident_id)

    @app.post("/lab/incidents/mitigate")
    async def mitigate():
        return await _require(await state["incidents"].mitigate())

    @app.post("/lab/incidents/verify")
    async def verify():
        return await _require(await state["incidents"].verify())

    @app.post("/lab/incidents/stop")
    async def stop_incident():
        await state["incidents"].stop()
        return {"status": "stopped"}

    # --- load --------------------------------------------------------------------------------

    @app.get("/lab/load")
    async def load_status():
        return state["load"].status()

    @app.post("/lab/load")
    async def start_load(body: LoadRequest):
        state["load"].start(body)
        return state["load"].status()

    @app.delete("/lab/load")
    async def stop_load():
        state["load"].stop()
        return state["load"].status()

    # --- telemetry ---------------------------------------------------------------------------

    @app.get("/lab/metrics/services")
    async def service_metrics(window: str = Query("1m", pattern=r"^(30s|1m|5m)$")):
        return await state["telemetry"].service_metrics(window)

    @app.get("/lab/metrics/timeseries")
    async def timeseries(minutes: int = Query(15, ge=5, le=60)):
        return await state["telemetry"].timeseries(minutes)

    @app.get("/lab/metrics/pools")
    async def pools():
        return await state["telemetry"].pool_metrics()

    @app.get("/lab/servicemap")
    async def service_map(window: str = Query("1m", pattern=r"^(30s|1m|5m)$")):
        return await state["telemetry"].service_map(window)

    @app.get("/lab/traces")
    async def traces(
        service: str | None = Query(None, max_length=40),
        errors_only: bool = False,
        min_duration_ms: int | None = Query(None, ge=0, le=60_000),
        operation: str | None = Query(None, max_length=20),
        minutes: int = Query(15, ge=1, le=180),
        limit: int = Query(20, ge=1, le=50),
    ):
        if service and service not in APP_SERVICES:
            raise HTTPException(400, f"service must be one of {', '.join(APP_SERVICES)}")
        return await state["telemetry"].search_traces(
            service, errors_only, min_duration_ms, operation, minutes, limit
        )

    @app.get("/lab/traces/{trace_id}")
    async def trace(trace_id: str):
        found = await state["telemetry"].get_trace(trace_id)
        if found is None:
            raise HTTPException(404, "trace not found (it can take a few seconds to arrive)")
        return found

    @app.get("/lab/logs")
    async def logs(
        service: str | None = Query(None, max_length=40),
        severity: str | None = Query(None, max_length=10),
        trace_id: str | None = Query(None, max_length=32),
        search: str | None = Query(None, max_length=100),
        minutes: int = Query(15, ge=1, le=180),
        limit: int = Query(100, ge=1, le=500),
    ):
        return await state["telemetry"].logs(service, severity, trace_id, search, minutes, limit)

    return app


async def _require(value):
    if value is None:
        raise HTTPException(409, "no incident is running")
    return value


app = create_app()
