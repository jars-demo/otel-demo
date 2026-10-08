"""Inventory data in Redis: the product catalog, stock levels and reservations.

Keys:
    product:<id>        hash: name, description, category, price_cents
    stock:<id>          integer units available
    reservation:<oid>   hash: product_id -> quantity, expires after RESERVATION_TTL_S
"""

from __future__ import annotations

from dataclasses import dataclass

from redis.asyncio import Redis

RESERVATION_TTL_S = 15 * 60
INITIAL_STOCK = 50_000

CATALOG: list[dict[str, str | int]] = [
    {
        "id": "prod-001",
        "name": "Mechanical Keyboard",
        "category": "input",
        "price_cents": 8900,
        "description": "Tenkeyless, hot-swappable switches.",
    },
    {
        "id": "prod-002",
        "name": "USB-C Dock",
        "category": "accessories",
        "price_cents": 12900,
        "description": "Two displays, Ethernet and 100 W passthrough.",
    },
    {
        "id": "prod-003",
        "name": "Noise-Cancelling Headphones",
        "category": "audio",
        "price_cents": 19900,
        "description": "Over-ear, 30 hours of battery.",
    },
    {
        "id": "prod-004",
        "name": "4K Monitor",
        "category": "displays",
        "price_cents": 34900,
        "description": "27 inch IPS panel, USB-C input.",
    },
    {
        "id": "prod-005",
        "name": "Ergonomic Mouse",
        "category": "input",
        "price_cents": 4900,
        "description": "Vertical grip, quiet clicks.",
    },
    {
        "id": "prod-006",
        "name": "Laptop Stand",
        "category": "accessories",
        "price_cents": 3900,
        "description": "Aluminium, six height positions.",
    },
    {
        "id": "prod-007",
        "name": "1080p Webcam",
        "category": "video",
        "price_cents": 5900,
        "description": "Autofocus with a privacy shutter.",
    },
    {
        "id": "prod-008",
        "name": "Desk Lamp",
        "category": "accessories",
        "price_cents": 2900,
        "description": "Dimmable, warm to cool white.",
    },
]
PRODUCT_IDS = [str(p["id"]) for p in CATALOG]

# Check every line, then decrement every line, in one atomic step: no partial reservations.
# KEYS: reservation key, then one stock key per line. ARGV: TTL, then product id and quantity
# pairs. Returns 0 on success, or the 1-based index of the first line without enough stock.
# Idempotent: reserving an order that already holds a reservation changes nothing, so callers
# can safely retry after a timeout.
RESERVE_SCRIPT = """
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
local lines = (#ARGV - 1) / 2
for i = 1, lines do
  local stock = tonumber(redis.call('GET', KEYS[i + 1]) or '0')
  if stock < tonumber(ARGV[i * 2 + 1]) then return i end
end
for i = 1, lines do
  redis.call('DECRBY', KEYS[i + 1], ARGV[i * 2 + 1])
  redis.call('HSET', KEYS[1], ARGV[i * 2], ARGV[i * 2 + 1])
end
redis.call('EXPIRE', KEYS[1], ARGV[1])
return 0
"""


@dataclass(frozen=True)
class Product:
    id: str
    name: str
    description: str
    category: str
    price_cents: int
    stock: int


class InsufficientStock(Exception):
    def __init__(self, product_id: str) -> None:
        super().__init__(f"insufficient stock for {product_id}")
        self.product_id = product_id


class InventoryStore:
    def __init__(self, redis: Redis) -> None:
        self.redis = redis
        self._reserve = redis.register_script(RESERVE_SCRIPT)

    async def seed(self, restock: bool = False) -> None:
        """Create the catalog if missing. With restock=True, also reset stock levels."""
        pipe = self.redis.pipeline(transaction=False)
        for product in CATALOG:
            fields = {k: str(v) for k, v in product.items() if k != "id"}
            pipe.hset(f"product:{product['id']}", mapping=fields)
            if restock:
                pipe.set(f"stock:{product['id']}", INITIAL_STOCK)
            else:
                pipe.setnx(f"stock:{product['id']}", INITIAL_STOCK)
        await pipe.execute()
        # Load the Lua script up front; otherwise the first EVALSHA fails with NOSCRIPT.
        await self.redis.script_load(RESERVE_SCRIPT)

    async def get_products(self, ids: list[str]) -> list[Product]:
        """Fetch products in one round trip (a pipeline), skipping unknown ids."""
        pipe = self.redis.pipeline(transaction=False)
        for product_id in ids:
            pipe.hgetall(f"product:{product_id}")
            pipe.get(f"stock:{product_id}")
        raw = await pipe.execute()
        products = []
        for product_id, fields, stock in zip(ids, raw[0::2], raw[1::2], strict=True):
            if not fields:
                continue
            fields = {_text(k): _text(v) for k, v in fields.items()}
            products.append(
                Product(
                    id=product_id,
                    name=fields["name"],
                    description=fields["description"],
                    category=fields["category"],
                    price_cents=int(fields["price_cents"]),
                    stock=int(stock or 0),
                )
            )
        return products

    async def reserve(self, order_id: str, lines: list[tuple[str, int]]) -> None:
        keys = [f"reservation:{order_id}"] + [f"stock:{pid}" for pid, _ in lines]
        args: list[str | int] = [RESERVATION_TTL_S]
        for product_id, quantity in lines:
            args += [product_id, quantity]
        failed = int(await self._reserve(keys=keys, args=args))
        if failed:
            raise InsufficientStock(lines[failed - 1][0])

    async def release(self, order_id: str) -> int:
        """Return reserved units to stock (compensation when payment fails)."""
        key = f"reservation:{order_id}"
        held = await self.redis.hgetall(key)
        if not held:
            return 0
        pipe = self.redis.pipeline(transaction=True)
        for product_id, quantity in held.items():
            pipe.incrby(f"stock:{_text(product_id)}", int(quantity))
        pipe.delete(key)
        await pipe.execute()
        return len(held)


def _text(value: bytes | str) -> str:
    return value.decode() if isinstance(value, bytes) else value
