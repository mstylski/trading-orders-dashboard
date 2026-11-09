-- All order fields and the contract size needed by the dashboard.
-- Current quotes still come from the WebSocket; they are not stored here.
SELECT
    o.id,
    i.symbol,
    o.side,
    o.size,
    o.open_price,
    o.open_time,
    o.swap,
    ct.contract_type,
    ct.contract_size
FROM orders AS o
JOIN instruments AS i ON i.symbol = o.symbol
JOIN contract_types AS ct ON ct.contract_type = i.contract_type
ORDER BY o.id;

-- Match the dashboard's count, total size, arithmetic mean price and swap.
SELECT
    symbol,
    count(*) AS order_count,
    sum(size) AS total_size,
    avg(open_price) AS average_open_price,
    sum(swap) AS total_swap
FROM orders
GROUP BY symbol
ORDER BY symbol;
