import { ContractType, Instrument, Order } from '../models/order.models';
import { isFiniteNumber, isRecord } from './validation';

function isSymbol(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isOrder(value: unknown): value is Order {
  if (!isRecord(value)) return false;
  return (
    isFiniteNumber(value['id']) &&
    Number.isSafeInteger(value['id']) &&
    value['id'] >= 0 &&
    isSymbol(value['symbol']) &&
    (value['side'] === 'BUY' || value['side'] === 'SELL') &&
    isFiniteNumber(value['size']) &&
    value['size'] > 0 &&
    isFiniteNumber(value['openPrice']) &&
    value['openPrice'] > 0 &&
    isFiniteNumber(value['openTime']) &&
    Number.isFinite(new Date(value['openTime']).getTime()) &&
    isFiniteNumber(value['swap'])
  );
}

export function isInstrument(value: unknown): value is Instrument {
  return (
    isRecord(value) &&
    isSymbol(value['symbol']) &&
    isFiniteNumber(value['contractType']) &&
    Number.isInteger(value['contractType'])
  );
}

export function isContract(value: unknown): value is ContractType {
  return (
    isRecord(value) &&
    isFiniteNumber(value['contractType']) &&
    Number.isInteger(value['contractType']) &&
    isFiniteNumber(value['contractSize']) &&
    value['contractSize'] > 0
  );
}

export function validateList<T>(
  value: unknown,
  guard: (item: unknown) => item is T,
  key: (item: T) => unknown,
  label: string,
): T[] {
  if (
    !Array.isArray(value) ||
    !value.every(guard) ||
    new Set(value.map(key)).size !== value.length
  ) {
    throw new Error(`Nieprawidłowe dane: ${label}.`);
  }
  return value;
}

