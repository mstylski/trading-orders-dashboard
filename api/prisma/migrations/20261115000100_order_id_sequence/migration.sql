-- Database-generated IDs stay compatible with the JSON number contract.
CREATE SEQUENCE "orders_id_seq" AS BIGINT MINVALUE 1 MAXVALUE 9007199254740991;
ALTER SEQUENCE "orders_id_seq" OWNED BY "orders"."id";
ALTER TABLE "orders" ALTER COLUMN "id" SET DEFAULT nextval('"orders_id_seq"');

-- Existing snapshot IDs must never collide with newly generated ones.
SELECT setval('"orders_id_seq"', COALESCE(MAX("id"), 1), MAX("id") IS NOT NULL)
FROM "orders";
