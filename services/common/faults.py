"""In-process fault injection: small, bounded, reversible switches each service exposes.

Each service declares a pydantic model of the faults it supports (all off by default) and mounts
`fault_router()`. The lab-console reads and changes them over the internal Docker network:

    GET  /internal/faults      current values
    PUT  /internal/faults      replace values (validated against the model's bounds)
    POST /internal/faults/reset

The /internal paths are excluded from tracing (see `common.app`), so turning a fault on does not
itself show up in the traces you investigate. Faults live in memory: restarting a service clears
them, which is the safe default.

Network faults (latency between a service and Redis or PostgreSQL) are not here: they are real
network latency added by Toxiproxy, controlled by the lab-console.
"""

import logging
from collections.abc import Awaitable, Callable

from fastapi import APIRouter
from pydantic import BaseModel

log = logging.getLogger(__name__)


class FaultState[F: BaseModel]:
    """Holds the current fault values for one service, plus deterministic counters."""

    def __init__(
        self, model: type[F], on_change: Callable[[F], Awaitable[None]] | None = None
    ) -> None:
        self.model = model
        self.current: F = model()
        self.on_change = on_change
        self._counters: dict[str, int] = {}

    async def replace(self, values: F) -> F:
        self.current = values
        self._counters.clear()
        if self.on_change:
            await self.on_change(values)
        active = {k: v for k, v in values.model_dump().items() if v}
        log.warning("fault configuration changed", extra={"lab.faults.active": str(active)})
        return self.current

    async def reset(self) -> F:
        return await self.replace(self.model())

    def every_nth(self, name: str, n: int) -> bool:
        """True on every n-th call (n > 0). Deterministic, so incidents reproduce exactly."""
        if n <= 0:
            return False
        count = self._counters.get(name, 0) + 1
        self._counters[name] = count
        return count % n == 0


def fault_router(state: FaultState) -> APIRouter:
    router = APIRouter(prefix="/internal/faults", tags=["internal"])
    model = state.model

    @router.get("", response_model=model)
    async def get_faults():
        return state.current

    @router.put("", response_model=model)
    async def put_faults(values: model):  # type: ignore[valid-type]
        return await state.replace(values)

    @router.post("/reset", response_model=model)
    async def reset_faults():
        return await state.reset()

    return router
