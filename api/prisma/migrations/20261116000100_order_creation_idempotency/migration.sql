CREATE TABLE "order_creations" (
    "scope" TEXT NOT NULL,
    "key" UUID NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status_code" SMALLINT,
    "response_body" JSONB,
    "order_id" BIGINT,
    CONSTRAINT "order_creations_pkey" PRIMARY KEY ("scope", "key"),
    CONSTRAINT "order_creations_request_hash_check" CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "order_creations_result_check" CHECK (
      ("status_code" IS NULL AND "response_body" IS NULL AND "order_id" IS NULL)
      OR ("status_code" IS NOT NULL AND "status_code" = 201 AND "response_body" IS NOT NULL AND "order_id" IS NOT NULL)
    ),
    CONSTRAINT "order_creations_order_fk" FOREIGN KEY ("order_id")
      REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE RESTRICT
);

CREATE UNIQUE INDEX "order_creations_order_id_key" ON "order_creations"("order_id");
