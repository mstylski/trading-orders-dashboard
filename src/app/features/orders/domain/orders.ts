import {
  ContractSizes,
  ContractType,
  Instrument,
  Order,
  OrderGroup,
  Quote,
  Quotes,
} from '../models/order.models';

export function buildContractSizes(
  instruments: readonly Instrument[],
  contracts: readonly ContractType[],
): ContractSizes {
  const sizes = new Map(
    contracts.map((contract) => [contract.contractType, contract.contractSize]),
  );
  const bySymbol = new Map<string, number>();
  for (const instrument of instruments) {
    const size = sizes.get(instrument.contractType);
    if (size !== undefined) bySymbol.set(instrument.symbol, size);
  }
  return bySymbol;
}

export function calculateProfit(
  order: Order,
  quote: Quote | undefined,
  contractSize: number | undefined,
): number | null {
  if (!quote || contractSize === undefined) return null;
  const profit =
    (quote.bid - order.openPrice) * order.size * contractSize * (order.side === 'BUY' ? 1 : -1);
  return Number.isFinite(profit) ? profit : null;
}

export function groupOrders(
  orders: readonly Order[],
  quotes: Quotes,
  contractSizes: ContractSizes,
): readonly OrderGroup[] {
  const bySymbol = new Map<string, Order[]>();
  for (const order of orders) {
    const group = bySymbol.get(order.symbol);
    if (group) group.push(order);
    else bySymbol.set(order.symbol, [order]);
  }
  return Array.from(bySymbol, ([symbol, members]) => {
    const rows = members.map((order) => ({
      ...order,
      profit: calculateProfit(order, quotes.get(symbol), contractSizes.get(symbol)),
    }));
    const hasAllProfits = rows.every((row) => row.profit !== null);
    const profit = hasAllProfits ? rows.reduce((sum, row) => sum + row.profit!, 0) : null;
    return {
      symbol,
      count: rows.length,
      size: rows.reduce((sum, row) => sum + row.size, 0),
      openPrice: rows.reduce((sum, row) => sum + row.openPrice, 0) / rows.length,
      swap: rows.reduce((sum, row) => sum + row.swap, 0),
      profit: profit !== null && Number.isFinite(profit) ? profit : null,
      profitUnavailableReason: !contractSizes.has(symbol)
        ? 'Brak wartości kontraktu dla tego instrumentu.'
        : !quotes.has(symbol)
          ? 'Oczekiwanie na pierwsze kwotowanie.'
          : !hasAllProfits || (profit !== null && !Number.isFinite(profit))
            ? 'Wynik przekracza obsługiwany zakres liczbowy.'
            : null,
      orders: rows,
    };
  });
}
