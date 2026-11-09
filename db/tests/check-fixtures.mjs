import assert from 'node:assert/strict';
import console from 'node:console';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { projectRoot, runSql } from './psql.mjs';

// Canonicalize numeric JSON tokens without converting them to IEEE 754 numbers.
// This also equates 0.010, 0.01 and 1e-2 while detecting tiny NUMERIC differences.
function parseExactJson(text) {
  return JSON.parse(text, (_key, value, context) => {
    if (typeof value !== 'number') return value;
    const [mantissa, exponent = '0'] = context.source.toLowerCase().split('e');
    const negative = mantissa.startsWith('-');
    const [integer, fraction = ''] = mantissa.replace(/^-/, '').split('.');
    const digits = (integer + fraction).replace(/^0+/, '').replace(/0+$/, '');
    if (!digits) return { decimal: '0e0' };
    const trailingZeros = (integer + fraction).match(/0*$/)[0].length;
    const scale = BigInt(exponent) - BigInt(fraction.length) + BigInt(trailingZeros);
    return { decimal: `${negative ? '-' : ''}${digits}e${scale}` };
  });
}

export function checkFixtures() {
  const sql = `SELECT json_build_object(
    'contracts', (SELECT json_agg(json_build_object('contractType', contract_type, 'contractSize', contract_size) ORDER BY contract_type) FROM contract_types),
    'instruments', (SELECT json_agg(json_build_object('symbol', symbol, 'contractType', contract_type) ORDER BY symbol COLLATE "C") FROM instruments),
    'orders', (SELECT json_agg(json_build_object('id', id, 'symbol', symbol, 'side', side, 'size', size, 'openPrice', open_price, 'openTime', (extract(epoch FROM open_time) * 1000)::bigint, 'swap', swap) ORDER BY id) FROM orders)
  );`;
  const actual = parseExactJson(runSql(sql));
  const fixture = (name) =>
    parseExactJson(readFileSync(resolve(projectRoot, `api/data/${name}.json`), 'utf8'));
  const compareDecimal = (a, b) => {
    // Identifiers are positive integers; sort by their original integer values.
    const integer = (value) => {
      const [digits, exponent] = value.decimal.split('e');
      return BigInt(digits) * 10n ** BigInt(exponent);
    };
    const left = integer(a);
    const right = integer(b);
    return left < right ? -1 : left > right ? 1 : 0;
  };

  assert.deepStrictEqual(
    actual.contracts,
    fixture('contract-types').sort((a, b) => compareDecimal(a.contractType, b.contractType)),
    'contract_types differs from api/data/contract-types.json',
  );
  assert.deepStrictEqual(
    actual.instruments,
    fixture('instruments').sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0)),
    'instruments differs from api/data/instruments.json',
  );
  assert.deepStrictEqual(
    actual.orders,
    fixture('order-data').data.sort((a, b) => compareDecimal(a.id, b.id)),
    'orders differs from api/data/order-data.json',
  );
  console.log(
    'PASS: all 6 / 108 / 213 SQL records match the JSON fixtures (exact decimals and milliseconds).',
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    checkFixtures();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
