-- Schema for the shop. Runs once, when the PostgreSQL volume is first created.
-- order-service owns orders and order_items; payment-service owns payments. They share one
-- database to keep the lab small; in production each service would usually own its own.

CREATE TABLE orders (
    id           TEXT PRIMARY KEY,
    user_id      TEXT        NOT NULL,
    status       TEXT        NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
    total_cents  INTEGER     NOT NULL CHECK (total_cents >= 0),
    failure      TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
    order_id          TEXT    NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    product_id        TEXT    NOT NULL,
    quantity          INTEGER NOT NULL CHECK (quantity > 0),
    unit_price_cents  INTEGER NOT NULL CHECK (unit_price_cents >= 0),
    PRIMARY KEY (order_id, product_id)
);

CREATE TABLE payments (
    id            TEXT PRIMARY KEY,
    order_id      TEXT        NOT NULL,
    status        TEXT        NOT NULL CHECK (status IN ('authorized', 'declined', 'failed')),
    amount_cents  INTEGER     NOT NULL CHECK (amount_cents >= 0),
    currency      TEXT        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX orders_user_id_idx ON orders (user_id);
CREATE INDEX payments_order_id_idx ON payments (order_id);
