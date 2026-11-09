\set ON_ERROR_STOP on
\pset pager off

BEGIN;

SELECT 'contract_types' AS table_name, count(*) AS row_count FROM contract_types
UNION ALL
SELECT 'instruments', count(*) FROM instruments
UNION ALL
SELECT 'orders', count(*) FROM orders;

DO $$
DECLARE
    invalid_contract_size numeric;
    invalid_numeric numeric;
    invalid_symbol text;
    invalid_id bigint;
    required_field record;
BEGIN
    IF (SELECT count(*) FROM contract_types) <> 6
        OR (SELECT count(*) FROM instruments) <> 108
        OR (SELECT count(*) FROM orders) <> 213 THEN
        RAISE EXCEPTION 'Unexpected seed counts (expected 6 / 108 / 213)';
    END IF;

    IF (SELECT count(*) FROM orders AS o
        JOIN instruments AS i ON i.symbol = o.symbol
        JOIN contract_types AS ct ON ct.contract_type = i.contract_type) <> 213 THEN
        RAISE EXCEPTION 'JOIN must return all 213 seeded orders';
    END IF;

    IF (SELECT count(*) FROM orders WHERE symbol = 'BTCUSD') <> 3
        OR (SELECT count(*) FROM orders WHERE symbol = 'EURPLN') <> 22 THEN
        RAISE EXCEPTION 'Unexpected order counts for BTCUSD / EURPLN';
    END IF;

    BEGIN
        INSERT INTO orders (id, symbol, side, size, open_price, open_time, swap)
        VALUES (999999999, '__MISSING_INSTRUMENT__', 'BUY', 0.01, 1, now(), 0);
        RAISE EXCEPTION 'FAIL: order with a nonexistent instrument was accepted';
    EXCEPTION WHEN foreign_key_violation THEN
        RAISE NOTICE 'PASS: orders_instrument_fk rejected a nonexistent instrument (23503)';
    END;

    BEGIN
        INSERT INTO instruments (symbol, contract_type)
        VALUES ('__MISSING_CONTRACT_TYPE__', 32767);
        RAISE EXCEPTION 'FAIL: instrument with a nonexistent contract type was accepted';
    EXCEPTION WHEN foreign_key_violation THEN
        RAISE NOTICE 'PASS: instruments_contract_type_fk rejected a nonexistent contract type (23503)';
    END;

    BEGIN
        DELETE FROM instruments WHERE symbol = 'BTCUSD';
        RAISE EXCEPTION 'FAIL: an instrument referenced by orders was deleted';
    EXCEPTION WHEN restrict_violation THEN
        RAISE NOTICE 'PASS: an instrument referenced by orders cannot be deleted (23001)';
    END;

    BEGIN
        INSERT INTO orders (id, symbol, side, size, open_price, open_time, swap)
        VALUES (999999999, 'BTCUSD', 'BUY', 0, 1, now(), 0);
        RAISE EXCEPTION 'FAIL: order with zero size was accepted';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'PASS: zero order size was rejected (23514)';
    END;

    BEGIN
        INSERT INTO orders (id, symbol, side, size, open_price, open_time, swap)
        VALUES (999999999, 'BTCUSD', 'HOLD', 0.01, 1, now(), 0);
        RAISE EXCEPTION 'FAIL: order with an invalid side was accepted';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'PASS: invalid order side was rejected (23514)';
    END;

    BEGIN
        INSERT INTO orders (id, symbol, side, size, open_price, open_time, swap)
        VALUES (999999999, 'BTCUSD', 'BUY', 0.01, -1, now(), 0);
        RAISE EXCEPTION 'FAIL: order with a negative opening price was accepted';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'PASS: negative opening price was rejected (23514)';
    END;

    BEGIN
        INSERT INTO orders (id, symbol, side, size, open_price, open_time, swap)
        VALUES (999999999, 'BTCUSD', 'BUY', 0.01, 1, 'infinity'::timestamptz, 0);
        RAISE EXCEPTION 'FAIL: order with an infinite opening time was accepted';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'PASS: infinite opening time was rejected (23514)';
    END;

    BEGIN
        INSERT INTO orders (id, symbol, side, size, open_price, open_time, swap)
        SELECT id, symbol, side, size, open_price, open_time, swap
        FROM orders ORDER BY id LIMIT 1;
        RAISE EXCEPTION 'FAIL: duplicate order ID was accepted';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'PASS: duplicate order ID was rejected (23505)';
    END;

    FOREACH invalid_contract_size IN ARRAY ARRAY[0, -1, 'NaN', 'Infinity', '-Infinity']::numeric[] LOOP
        BEGIN
            INSERT INTO contract_types (contract_type, contract_size)
            VALUES (32767, invalid_contract_size);
            RAISE EXCEPTION 'FAIL: invalid contract size % was accepted', invalid_contract_size;
        EXCEPTION WHEN check_violation THEN
            RAISE NOTICE 'PASS: contract size % was rejected (23514)', invalid_contract_size;
        END;
    END LOOP;

    FOREACH invalid_numeric IN ARRAY ARRAY['NaN', 'Infinity', '-Infinity']::numeric[] LOOP
        BEGIN
            INSERT INTO orders (id, symbol, side, size, open_price, open_time, swap)
            VALUES (999999999, 'BTCUSD', 'BUY', invalid_numeric, 1, now(), 0);
            RAISE EXCEPTION 'FAIL: order size % was accepted', invalid_numeric;
        EXCEPTION WHEN check_violation THEN
            RAISE NOTICE 'PASS: order size % was rejected (23514)', invalid_numeric;
        END;

        BEGIN
            INSERT INTO orders (id, symbol, side, size, open_price, open_time, swap)
            VALUES (999999999, 'BTCUSD', 'BUY', 0.01, invalid_numeric, now(), 0);
            RAISE EXCEPTION 'FAIL: opening price % was accepted', invalid_numeric;
        EXCEPTION WHEN check_violation THEN
            RAISE NOTICE 'PASS: opening price % was rejected (23514)', invalid_numeric;
        END;

        BEGIN
            INSERT INTO orders (id, symbol, side, size, open_price, open_time, swap)
            VALUES (999999999, 'BTCUSD', 'BUY', 0.01, 1, now(), invalid_numeric);
            RAISE EXCEPTION 'FAIL: swap % was accepted', invalid_numeric;
        EXCEPTION WHEN check_violation THEN
            RAISE NOTICE 'PASS: swap % was rejected (23514)', invalid_numeric;
        END;
    END LOOP;

    FOREACH invalid_symbol IN ARRAY ARRAY['', '   '] LOOP
        BEGIN
            INSERT INTO instruments (symbol, contract_type)
            SELECT invalid_symbol, contract_type FROM contract_types ORDER BY contract_type LIMIT 1;
            RAISE EXCEPTION 'FAIL: blank instrument symbol was accepted';
        EXCEPTION WHEN check_violation THEN
            RAISE NOTICE 'PASS: blank instrument symbol % was rejected (23514)', quote_literal(invalid_symbol);
        END;
    END LOOP;

    FOREACH invalid_id IN ARRAY ARRAY[0, -1]::bigint[] LOOP
        BEGIN
            INSERT INTO orders (id, symbol, side, size, open_price, open_time, swap)
            VALUES (invalid_id, 'BTCUSD', 'BUY', 0.01, 1, now(), 0);
            RAISE EXCEPTION 'FAIL: order ID % was accepted', invalid_id;
        EXCEPTION WHEN check_violation THEN
            RAISE NOTICE 'PASS: order ID % was rejected (23514)', invalid_id;
        END;
    END LOOP;

    FOR required_field IN
        SELECT * FROM (VALUES
            ('contract_types', 'contract_type'),
            ('contract_types', 'contract_size'),
            ('instruments', 'symbol'),
            ('instruments', 'contract_type'),
            ('orders', 'id'),
            ('orders', 'symbol'),
            ('orders', 'side'),
            ('orders', 'size'),
            ('orders', 'open_price'),
            ('orders', 'open_time'),
            ('orders', 'swap')
        ) AS required_fields(table_name, column_name)
    LOOP
        BEGIN
            EXECUTE format('UPDATE %I SET %I = NULL', required_field.table_name, required_field.column_name);
            RAISE EXCEPTION 'FAIL: NULL %.% was accepted', required_field.table_name, required_field.column_name;
        EXCEPTION WHEN not_null_violation THEN
            RAISE NOTICE 'PASS: NULL %.% was rejected (23502)', required_field.table_name, required_field.column_name;
        END;
    END LOOP;

    BEGIN
        UPDATE instruments SET symbol = '__UPDATED_BTCUSD__' WHERE symbol = 'BTCUSD';
        RAISE EXCEPTION 'FAIL: an instrument key referenced by orders was updated';
    EXCEPTION WHEN restrict_violation THEN
        RAISE NOTICE 'PASS: a referenced instrument key cannot be updated (23001)';
    END;

    BEGIN
        UPDATE contract_types SET contract_type = 32767
        WHERE contract_type = (SELECT contract_type FROM instruments WHERE symbol = 'BTCUSD');
        RAISE EXCEPTION 'FAIL: a contract type key referenced by instruments was updated';
    EXCEPTION WHEN restrict_violation THEN
        RAISE NOTICE 'PASS: a referenced contract type key cannot be updated (23001)';
    END;
END
$$;

-- Verification never persists its test records or mutations.
ROLLBACK;
