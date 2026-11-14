-- Run against trading_orders_prisma_dev after applying Prisma migrations.
-- Equivalent database reads for GET /orders without status or with status=open.
-- The API maps BigInt/Decimal/Date to checked JSON numbers afterwards.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

-- Must return no rows: JavaScript Date cannot preserve PostgreSQL microseconds.
SELECT id
FROM public.orders
WHERE open_time <> date_trunc('milliseconds', open_time)
LIMIT 1;

SELECT id, symbol, side, size,
       open_price AS "openPrice", open_time AS "openTime", swap
FROM public.orders
ORDER BY display_order ASC NULLS LAST, id ASC;

COMMIT;

-- ANALYZE executes this read-only SELECT and reports actual rows/timing.
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, symbol, side, size,
       open_price AS "openPrice", open_time AS "openTime", swap
FROM public.orders
ORDER BY display_order ASC NULLS LAST, id ASC;

