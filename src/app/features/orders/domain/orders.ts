import {
  ContractSizeBySymbol,
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
): ContractSizeBySymbol {
  const contractSizeByType = new Map(
    contracts.map((contract) => [contract.contractType, contract.contractSize]),
  );
  const bySymbol = new Map<string, number>();
  for (const instrument of instruments) {
    const size = contractSizeByType.get(instrument.contractType);
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
  contractSizes: ContractSizeBySymbol,
): readonly OrderGroup[] {
  return applyQuotes(prepareOrderGroups(orders), quotes, contractSizes);
}

export interface GroupedOrders {
  readonly symbol: string;
  readonly count: number;
  readonly size: number;
  readonly openPrice: number;
  readonly swap: number;
  readonly orders: readonly Order[];
}

export function prepareOrderGroups(orders: readonly Order[]): readonly GroupedOrders[] {
  const bySymbol = new Map<string, Order[]>();
  for (const order of orders) {
    const group = bySymbol.get(order.symbol);
    if (group) group.push(order);
    else bySymbol.set(order.symbol, [order]);
  }
  return Array.from(bySymbol, ([symbol, members]) => ({
    symbol,
    count: members.length,
    size: members.reduce((sum, order) => sum + order.size, 0),
    openPrice: members.reduce((sum, order) => sum + order.openPrice, 0) / members.length,
    swap: members.reduce((sum, order) => sum + order.swap, 0),
    orders: members,
  }));
}

export function applyQuotes(
  groups: readonly GroupedOrders[],
  quotes: Quotes,
  contractSizes: ContractSizeBySymbol,
): readonly OrderGroup[] {
  return groups.map((group) => {
    const { symbol } = group;
    const rows = group.orders.map((order) => ({
      ...order,
      profit: calculateProfit(order, quotes.get(symbol), contractSizes.get(symbol)),
    }));
    const hasAllProfits = rows.every((row) => row.profit !== null);
    const profit = hasAllProfits ? rows.reduce((sum, row) => sum + row.profit!, 0) : null;
    return {
      symbol: group.symbol,
      count: group.count,
      size: group.size,
      openPrice: group.openPrice,
      swap: group.swap,
      profit: profit !== null && Number.isFinite(profit) ? profit : null,
      profitUnavailableReason: !contractSizes.has(symbol)
        ? 'missing-contract'
        : !quotes.has(symbol)
          ? 'awaiting-quote'
          : !hasAllProfits || (profit !== null && !Number.isFinite(profit))
            ? 'overflow'
            : null,
      orders: rows,
    };
  });
}
