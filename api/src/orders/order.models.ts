export interface Order {
  readonly id: number;
  readonly symbol: string;
  readonly side: 'BUY' | 'SELL';
  readonly size: number;
  readonly openPrice: number;
  readonly openTime: number;
  readonly swap: number;
}

export interface CreationResult {
  statusCode: number;
  body: { data: Order };
}
