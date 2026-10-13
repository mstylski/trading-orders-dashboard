// API and quote data
export type OrderSide = 'BUY' | 'SELL';

export interface Order {
  readonly id: number;
  readonly symbol: string;
  readonly side: OrderSide;
  readonly size: number;
  readonly openPrice: number;
  readonly openTime: number;
  readonly swap: number;
}

export interface Instrument {
  readonly symbol: string;
  readonly contractType: number;
}

export interface ContractType {
  readonly contractType: number;
  readonly contractSize: number;
}

export interface OrdersData {
  readonly orders: readonly Order[];
  readonly instruments: readonly Instrument[];
  readonly contracts: readonly ContractType[];
}

export interface Quote {
  readonly symbol: string;
  readonly bid: number;
  readonly ask: number;
  readonly timestamp: number;
}

export type Quotes = ReadonlyMap<string, Quote>;
export type ContractSizeBySymbol = ReadonlyMap<string, number>;

// Presentation data
export type ProfitUnavailableReason = 'missing-contract' | 'awaiting-quote' | 'overflow';
export type PriceUnavailableReason =
  'select-symbol' | 'missing-contract' | 'disconnected' | 'awaiting-quote' | 'invalid-price';

export interface OrderRow extends Order {
  readonly profit: number | null;
}

export interface OrderGroup {
  readonly symbol: string;
  readonly count: number;
  readonly size: number;
  readonly openPrice: number;
  readonly swap: number;
  readonly profit: number | null;
  readonly profitUnavailableReason: ProfitUnavailableReason | null;
  readonly orders: readonly OrderRow[];
}

// State and command results
export type AddOrderError = 'invalid-input' | 'missing-contract' | 'stale-quote' | 'id-exhausted';
export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface NewOrder {
  readonly symbol: string;
  readonly side: OrderSide;
  readonly size: number;
  readonly openTime: number;
}

export type AddOrderResult = { readonly order: Order } | { readonly error: AddOrderError };
export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting';
