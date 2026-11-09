-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "contract_types" (
    "contract_type" SMALLINT NOT NULL,
    "contract_size" DECIMAL NOT NULL,

    CONSTRAINT "contract_types_pkey" PRIMARY KEY ("contract_type")
);

-- CreateTable
CREATE TABLE "instruments" (
    "symbol" TEXT NOT NULL,
    "contract_type" SMALLINT NOT NULL,

    CONSTRAINT "instruments_pkey" PRIMARY KEY ("symbol")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" BIGINT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "size" DECIMAL NOT NULL,
    "open_price" DECIMAL NOT NULL,
    "open_time" TIMESTAMPTZ(6) NOT NULL,
    "swap" DECIMAL NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "instruments_contract_type_idx" ON "instruments"("contract_type");

-- CreateIndex
CREATE INDEX "orders_symbol_idx" ON "orders"("symbol");

-- AddForeignKey
ALTER TABLE "instruments" ADD CONSTRAINT "instruments_contract_type_fk" FOREIGN KEY ("contract_type") REFERENCES "contract_types"("contract_type") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_instrument_fk" FOREIGN KEY ("symbol") REFERENCES "instruments"("symbol") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Prisma cannot express CHECK constraints. Preserve the rules from stage 02 SQL.
-- Bare DECIMAL above intentionally has no precision/scale (PostgreSQL NUMERIC).
ALTER TABLE "contract_types"
    ADD CONSTRAINT "contract_types_contract_type_check" CHECK (contract_type >= 0),
    ADD CONSTRAINT "contract_types_contract_size_check" CHECK (contract_size > 0 AND contract_size < 'Infinity'::numeric);

ALTER TABLE "instruments"
    ADD CONSTRAINT "instruments_symbol_check" CHECK (length(btrim(symbol)) > 0);

ALTER TABLE "orders"
    ADD CONSTRAINT "orders_id_check" CHECK (id > 0),
    ADD CONSTRAINT "orders_side_check" CHECK (side IN ('BUY', 'SELL')),
    ADD CONSTRAINT "orders_size_check" CHECK (size > 0 AND size < 'Infinity'::numeric),
    ADD CONSTRAINT "orders_open_price_check" CHECK (open_price > 0 AND open_price < 'Infinity'::numeric),
    ADD CONSTRAINT "orders_open_time_check" CHECK (isfinite(open_time)),
    ADD CONSTRAINT "orders_swap_check" CHECK (swap > '-Infinity'::numeric AND swap < 'Infinity'::numeric);
