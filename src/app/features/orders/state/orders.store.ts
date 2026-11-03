import {
  computed,
  DestroyRef,
  effect,
  inject,
  Injectable,
  PLATFORM_ID,
  RESPONSE_INIT,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { OrdersApiService } from '../data/orders-api.service';
import { InvalidPayloadError } from '../data/order.guards';
import { QuotesService } from '../data/quotes.service';
import { applyQuotes, buildContractSizes, prepareOrderGroups } from '../domain/orders';
import {
  AddOrderResult,
  ContractSizeBySymbol,
  LoadStatus,
  NewOrder,
  Order,
  OrdersData,
  PriceUnavailableReason,
} from '../models/order.models';

@Injectable()
export class OrdersStore {
  private readonly api = inject(OrdersApiService);
  private readonly quoteService = inject(QuotesService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly responseInit = inject(RESPONSE_INIT, { optional: true });
  private readonly orderState = signal<readonly Order[]>([]);
  private readonly symbolState = signal<readonly string[]>([]);
  private readonly contractState = signal<ContractSizeBySymbol>(new Map());
  private readonly loadingState = signal<LoadStatus>('idle');
  private readonly errorState = signal<string | null>(null);
  private readonly selectedSymbolState = signal<string | null>(null);
  private nextId = 1;

  // Read models for the page and its form.
  readonly orders = this.orderState.asReadonly();
  readonly symbols = this.symbolState.asReadonly();
  readonly contractSizes = this.contractState.asReadonly();
  readonly status = this.loadingState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly selectedSymbol = this.selectedSymbolState.asReadonly();
  readonly quotes = this.quoteService.quotes;
  readonly connectionStatus = this.quoteService.status;
  readonly retryDelay = this.quoteService.retryDelay;
  private readonly groupedOrders = computed(() => prepareOrderGroups(this.orders()));
  readonly groups = computed(() =>
    applyQuotes(this.groupedOrders(), this.quotes(), this.contractSizes()),
  );
  readonly selectedPrice = computed(
    () => this.quotes().get(this.selectedSymbol() ?? '')?.bid ?? null,
  );
  readonly unavailablePriceReason = computed<PriceUnavailableReason | null>(() => {
    const symbol = this.selectedSymbol();
    if (!symbol) return 'select-symbol';
    if (!this.contractSizes().has(symbol)) return 'missing-contract';
    if (this.connectionStatus() !== 'connected') return 'disconnected';
    if (!this.quoteService.isFresh(symbol)) return 'awaiting-quote';
    if ((this.selectedPrice() ?? 0) <= 0) return 'invalid-price';
    return null;
  });
  readonly hasStaleQuotes = computed(() =>
    this.orders().some(
      (order) => this.quotes().has(order.symbol) && !this.quoteService.isFresh(order.symbol),
    ),
  );
  private readonly desiredSymbols = computed(() => {
    if (this.status() !== 'ready') return null;
    const symbols = new Set(this.orders().map((order) => order.symbol));
    const selected = this.selectedSymbol();
    if (selected) symbols.add(selected);
    return symbols;
  });

  constructor() {
    if (isPlatformBrowser(inject(PLATFORM_ID))) {
      effect(() => {
        const symbols = this.desiredSymbols();
        if (symbols) this.quoteService.setSymbols(symbols);
      });
    }
  }

  // Load and validate the initial snapshot.
  load(): void {
    if (this.status() !== 'idle' && this.status() !== 'error') return;
    this.loadingState.set('loading');
    this.errorState.set(null);
    this.api
      .load()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => this.applyLoadedData(data),
        error: (error: unknown) => this.handleLoadError(error),
      });
  }

  private applyLoadedData({ orders, instruments, contracts }: OrdersData): void {
    this.orderState.set(orders);
    this.symbolState.set([...new Set(orders.map((order) => order.symbol))]);
    this.contractState.set(buildContractSizes(instruments, contracts));
    this.nextId = orders.reduce((max, order) => Math.max(max, order.id), 0) + 1;
    this.loadingState.set('ready');
  }

  private handleLoadError(error: unknown): void {
    if (this.responseInit) {
      this.responseInit.status = error instanceof InvalidPayloadError ? 502 : 503;
    }
    this.loadingState.set('error');
    if (error instanceof InvalidPayloadError) {
      const resourceLabel = {
        orders: 'zlecenia',
        instruments: 'instrumenty',
        contracts: 'typy kontraktów',
      }[error.resource];
      this.errorState.set(`Nieprawidłowe dane: ${resourceLabel}.`);
    } else if (error instanceof HttpErrorResponse && error.status === 0) {
      this.errorState.set('Brak połączenia z serwerem danych. Sprawdź sieć i spróbuj ponownie.');
    } else {
      this.errorState.set('Nie udało się pobrać zleceń lub danych instrumentów. Spróbuj ponownie.');
    }
  }

  // Keep the form symbol in the quote subscription set.
  selectFormSymbol(symbol: string | null): void {
    this.selectedSymbolState.set(symbol && this.symbols().includes(symbol) ? symbol : null);
  }

  // Apply in-memory order commands; quote subscriptions follow the derived symbol set.
  addOrder(input: NewOrder): AddOrderResult {
    if (
      this.status() !== 'ready' ||
      !this.symbols().includes(input.symbol) ||
      (input.side !== 'BUY' && input.side !== 'SELL') ||
      !Number.isFinite(input.size) ||
      input.size <= 0 ||
      !Number.isFinite(input.openTime) ||
      !Number.isFinite(new Date(input.openTime).getTime())
    ) {
      return { error: 'invalid-input' };
    }
    if (!this.contractSizes().has(input.symbol)) return { error: 'missing-contract' };
    const quote = this.quotes().get(input.symbol);
    if (!quote || quote.bid <= 0 || !this.quoteService.isFresh(input.symbol)) {
      return { error: 'stale-quote' };
    }
    if (!Number.isSafeInteger(this.nextId)) return { error: 'id-exhausted' };
    const order: Order = { ...input, id: this.nextId++, openPrice: quote.bid, swap: 0 };
    this.orderState.update((orders) => [...orders, order]);
    return { order };
  }

  closeOrder(id: number): readonly number[] {
    return this.removeOrders((order) => order.id === id);
  }

  closeGroup(symbol: string): readonly number[] {
    return this.removeOrders((order) => order.symbol === symbol);
  }

  private removeOrders(matches: (order: Order) => boolean): readonly number[] {
    const removed = this.orders().filter(matches);
    if (removed.length) {
      this.orderState.update((orders) => orders.filter((order) => !matches(order)));
    }
    return removed.map((order) => order.id);
  }
}
