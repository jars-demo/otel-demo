"""SQL for orders. Every function takes an open connection; the caller decides which one."""

from __future__ import annotations

from psycopg import AsyncConnection
from psycopg.rows import dict_row


async def insert_order(
    conn: AsyncConnection, order_id: str, user_id: str, lines: list[dict], total_cents: int
) -> None:
    async with conn.transaction():
        await conn.execute(
            "INSERT INTO orders (id, user_id, status, total_cents) VALUES (%s, %s, 'pending', %s)",
            (order_id, user_id, total_cents),
        )
        async with conn.cursor() as cur:
            await cur.executemany(
                "INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents)"
                " VALUES (%s, %s, %s, %s)",
                [
                    (order_id, line["product_id"], line["quantity"], line["unit_price_cents"])
                    for line in lines
                ],
            )


async def set_status(
    conn: AsyncConnection, order_id: str, status: str, failure: str | None = None
) -> None:
    await conn.execute(
        "UPDATE orders SET status = %s, failure = %s, updated_at = now() WHERE id = %s",
        (status, failure, order_id),
    )


async def get_order(conn: AsyncConnection, order_id: str) -> dict | None:
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            "SELECT id, user_id, status, total_cents, failure, created_at, updated_at"
            " FROM orders WHERE id = %s",
            (order_id,),
        )
        order = await cur.fetchone()
        if order is None:
            return None
        await cur.execute(
            "SELECT product_id, quantity, unit_price_cents FROM order_items"
            " WHERE order_id = %s ORDER BY product_id",
            (order_id,),
        )
        order["items"] = await cur.fetchall()
    return order
