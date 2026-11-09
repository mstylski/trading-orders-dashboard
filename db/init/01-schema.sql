BEGIN;

CREATE TABLE contract_types (
    contract_type smallint PRIMARY KEY CHECK (contract_type >= 0),
    contract_size numeric NOT NULL CHECK (contract_size > 0 AND contract_size < 'Infinity'::numeric)
);

CREATE TABLE instruments (
    symbol text PRIMARY KEY CHECK (length(btrim(symbol)) > 0),
    contract_type smallint NOT NULL,
    CONSTRAINT instruments_contract_type_fk
        FOREIGN KEY (contract_type) REFERENCES contract_types (contract_type)
        ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE orders (
    id bigint PRIMARY KEY CHECK (id > 0),
    symbol text NOT NULL,
    side text NOT NULL CHECK (side IN ('BUY', 'SELL')),
    size numeric NOT NULL CHECK (size > 0 AND size < 'Infinity'::numeric),
    open_price numeric NOT NULL CHECK (open_price > 0 AND open_price < 'Infinity'::numeric),
    open_time timestamptz NOT NULL CHECK (isfinite(open_time)),
    swap numeric NOT NULL CHECK (swap > '-Infinity'::numeric AND swap < 'Infinity'::numeric),
    CONSTRAINT orders_instrument_fk
        FOREIGN KEY (symbol) REFERENCES instruments (symbol)
        ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX instruments_contract_type_idx ON instruments (contract_type);
CREATE INDEX orders_symbol_idx ON orders (symbol);

COMMIT;
