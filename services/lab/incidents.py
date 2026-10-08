"""Incident scenarios: load the definitions and run the baseline, inject, fix, verify cycle.

An incident run moves through phases:

    baseline    traffic starts with no faults; after BASELINE_S the lab records p95 and errors
    active      the incident's faults are on; you investigate
    mitigated   you applied the fix (faults off); traffic keeps flowing so recovery is visible
    resolved    verify() confirmed latency and errors are back near the baseline

Observability is about understanding change, so every run starts by measuring "normal".
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from pathlib import Path

import yaml

from lab.faults import BY_ID, FaultController
from lab.load import LoadGenerator, LoadRequest
from lab.telemetry import Telemetry

log = logging.getLogger(__name__)

BASELINE_S = int(os.getenv("LAB_BASELINE_S", "45"))
# Recovery passes when p95 is within this factor of the baseline (plus a small absolute slack)
# and the error rate is under this ratio.
RECOVERY_P95_FACTOR = 1.5
RECOVERY_P95_SLACK_MS = 100
RECOVERY_MAX_ERROR_RATIO = 0.02

REQUIRED = ("id", "slug", "title", "symptom", "trigger", "investigation", "question", "answer")


def load_incidents(directory: str | Path) -> dict[str, dict]:
    incidents: dict[str, dict] = {}
    for path in sorted(Path(directory).glob("*/incident.yaml")):
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        missing = [key for key in REQUIRED if key not in data]
        if missing:
            raise ValueError(f"{path}: missing {', '.join(missing)}")
        for fault_id in data["trigger"].get("faults", {}):
            if fault_id not in BY_ID:
                raise ValueError(f"{path}: unknown fault {fault_id}")
        LoadRequest(**data["trigger"]["load"])  # validates rps and duration limits
        incidents[data["id"]] = data
    return incidents


class IncidentRunner:
    def __init__(
        self,
        incidents: dict[str, dict],
        faults: FaultController,
        load: LoadGenerator,
        telemetry: Telemetry,
    ) -> None:
        self.incidents = incidents
        self.faults = faults
        self.load = load
        self.telemetry = telemetry
        self.active: dict | None = None
        self._task: asyncio.Task | None = None

    def state(self) -> dict | None:
        if not self.active:
            return None
        elapsed = time.time() - self.active["started_at"]
        return {**self.active, "elapsed_s": round(elapsed)}

    async def start(self, incident_id: str) -> dict:
        incident = self.incidents[incident_id]
        await self.stop()
        await self.faults.reset()
        await self.faults.restock()
        load = LoadRequest(**incident["trigger"]["load"])
        self.load.start(load)
        self.active = {
            "id": incident_id,
            "phase": "baseline",
            "started_at": time.time(),
            "baseline_until": time.time() + BASELINE_S,
            "baseline": None,
            "injected_at": None,
            "mitigated_at": None,
            "verification": None,
        }
        self._task = asyncio.create_task(self._inject_after_baseline(incident))
        log.info("incident started", extra={"lab.incident.id": incident_id})
        return self.state()

    async def _inject_after_baseline(self, incident: dict) -> None:
        await asyncio.sleep(BASELINE_S)
        self.active["baseline"] = await self.telemetry.gateway_snapshot(window="30s")
        await self.faults.apply(incident["trigger"].get("faults", {}))
        self.active["phase"] = "active"
        self.active["injected_at"] = time.time()
        log.info("incident faults injected", extra={"lab.incident.id": incident["id"]})

    async def mitigate(self) -> dict | None:
        """Apply the fix: turn the incident's faults off. Traffic keeps running."""
        if not self.active:
            return None
        if self._task and not self._task.done():
            self._task.cancel()  # fixed before the faults even landed
        await self.faults.reset()
        self.active["phase"] = "mitigated"
        self.active["mitigated_at"] = time.time()
        return self.state()

    async def verify(self) -> dict | None:
        """Compare the last 30 s with the baseline. Real numbers from Prometheus."""
        if not self.active:
            return None
        baseline = self.active.get("baseline")
        current = await self.telemetry.gateway_snapshot(window="30s")
        faults = await self.faults.current()
        faults_cleared = not any(value for value in faults.values())
        checks = [{"name": "All faults are off", "passed": faults_cleared}]
        if baseline and baseline.get("p95_ms") is not None and current.get("p95_ms") is not None:
            limit = baseline["p95_ms"] * RECOVERY_P95_FACTOR + RECOVERY_P95_SLACK_MS
            checks.append({
                "name": f"p95 latency under {limit:.0f} ms (baseline {baseline['p95_ms']:.0f} ms)",
                "passed": current["p95_ms"] <= limit,
            })  # fmt: skip
        else:
            checks.append({"name": "Enough traffic to measure p95", "passed": False})
        error_ratio = current.get("error_ratio")
        checks.append({
            "name": f"Error rate under {RECOVERY_MAX_ERROR_RATIO:.0%}",
            "passed": error_ratio is not None and error_ratio <= RECOVERY_MAX_ERROR_RATIO,
        })  # fmt: skip
        passed = all(check["passed"] for check in checks)
        result = {"passed": passed, "checks": checks, "baseline": baseline, "current": current}
        self.active["verification"] = result
        if passed and self.active["phase"] == "mitigated":
            self.active["phase"] = "resolved"
            self.load.stop()
        return result

    async def stop(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
        if self.active:
            self.load.stop()
            await self.faults.reset()
        self.active = None
