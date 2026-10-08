import { buildContractSizes, calculateProfit, groupOrders } from './orders';
import { testData, testOrders, testQuote } from '../testing/fixtures';

describe('Order calculations', () => {
  it('joins contract sizes through instrument contractType', () => {
    const sizes = buildContractSizes(testData.instruments, testData.contracts);
    expect(sizes.get('BTCUSD')).toBe(10);
    expect(sizes.get('EURUSD')).toBe(100000);
    expect(buildContractSizes(testData.instruments, []).size).toBe(0);
  });

  it('calculates BUY and SELL using bid, excluding swap', () => {
    expect(calculateProfit(testOrders[0], testQuote(), 10)).toBe(200);
    expect(calculateProfit(testOrders[2], testQuote(), 10)).toBe(100);
    expect(calculateProfit(testOrders[1], testQuote('EURUSD', 1.1), 100000)).toBeCloseTo(10000);
  });

  it('preserves zero prices and profits and reports missing values as null', () => {
    expect(calculateProfit(testOrders[0], testQuote('BTCUSD', 100), 10)).toBe(0);
    expect(calculateProfit(testOrders[0], testQuote('BTCUSD', 0), 10)).toBe(-2000);
    expect(calculateProfit(testOrders[0], undefined, 10)).toBeNull();
    expect(calculateProfit(testOrders[0], testQuote(), undefined)).toBeNull();
  });

  it('uses an arithmetic mean and sums individual mixed-side profits', () => {
    const groups = groupOrders(
      testOrders,
      new Map([['BTCUSD', testQuote()]]),
      buildContractSizes(testData.instruments, testData.contracts),
    );
    expect(groups.map((group) => group.symbol)).toEqual(['BTCUSD', 'EURUSD']);
    expect(groups[0]).toMatchObject({ count: 2, size: 3, openPrice: 110, swap: -0.5, profit: 300 });
    expect(groups[0].orders.map((order) => order.id)).toEqual([10, 20]);
    expect(groups[1].profit).toBeNull();
  });

  it('does not round intermediate values and explains missing mappings', () => {
    const order = { ...testOrders[0], openPrice: 0.000001, size: 0.03 };
    expect(calculateProfit(order, testQuote('BTCUSD', 0.000002), 100000)).toBeCloseTo(0.003, 12);
    const [group] = groupOrders([order], new Map([['BTCUSD', testQuote()]]), new Map());
    expect(group.profit).toBeNull();
    expect(group.profitUnavailableReason).toContain('kontraktu');
  });

  it('handles an empty collection and an overflow without displaying Infinity', () => {
    expect(groupOrders([], new Map(), new Map())).toEqual([]);
    expect(
      calculateProfit({ ...testOrders[0], size: Number.MAX_VALUE }, testQuote(), 10),
    ).toBeNull();
  });
});
