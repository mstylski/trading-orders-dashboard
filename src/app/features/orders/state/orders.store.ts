import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { OrdersApiService } from '../data/orders-api.service';
import { QuotesService } from '../data/quotes.service';
import { buildContractSizes, groupOrders } from '../domain/orders';
import { AddOrderResult, ContractSizes, NewOrder, Order, OrdersData } from '../models/order.models';

@Injectable()
export class OrdersStore {
  private readonly api = inject(OrdersApiService);
  private readonly quoteService = inject(QuotesService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly orderState = signal<readonly Order[]>([]);
  private readonly symbolState = signal<readonly string[]>([]);
  private readonly contractState = signal<ContractSizes>(new Map());
  private readonly loadingState = signal<'loading' | 'ready' | 'error'>('loading');
  private readonly errorState = signal<string | null>(null);
  private readonly selectedSymbolState = signal<string | null>(null);
  private loading = false;
  private nextId = 1;

  readonly orders = this.orderState.asReadonly();
  readonly symbols = this.symbolState.asReadonly();
  readonly contractSizes = this.contractState.asReadonly();
  readonly status = this.loadingState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly selectedSymbol = this.selectedSymbolState.asReadonly();
  readonly quotes = this.quoteService.quotes;
  readonly connectionStatus = this.quoteService.status;
  readonly retryDelay = this.quoteService.retryDelay;
  readonly groups = computed(() => groupOrders(this.orders(), this.quotes(), this.contractSizes()));
  readonly selectedPrice = computed(
    () => this.quotes().get(this.selectedSymbol() ?? '')?.bid ?? null,
  );
  readonly unavailablePriceReason = computed(() => {
    const symbol = this.selectedSymbol();
    if (!symbol) return 'Wybierz symbol, aby pobrać bieżącą cenę.';
    if (!this.contractSizes().has(symbol)) return 'Brak wartości kontraktu dla wybranego symbolu.';
    if (this.connectionStatus() !== 'connected')
      return 'Brak połączenia z kwotowaniami. Poczekaj na ponowne połączenie.';
    if (!this.quoteService.isFresh(symbol))
      return 'Oczekiwanie na świeże kwotowanie wybranego symbolu.';
    if ((this.selectedPrice() ?? 0) <= 0) return 'Bieżąca cena musi być większa od zera.';
    return null;
  });
  readonly hasStaleQuotes = computed(() =>
    this.orders().some(
      (order) => this.quotes().has(order.symbol) && !this.quoteService.isFresh(order.symbol),
    ),
  );

  load(): void {
    if (this.loading || this.status() === 'ready') return;
    this.loading = true;
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
    this.loading = false;
    this.syncSymbols();
  }

  private handleLoadError(error: unknown): void {
    this.loading = false;
    this.loadingState.set('error');
    this.errorState.set(
      error instanceof Error && !(error instanceof HttpErrorResponse)
        ? error.message
        : 'Nie udało się pobrać zleceń lub danych instrumentów. Sprawdź połączenie i spróbuj ponownie.',
    );
  }

  selectFormSymbol(symbol: string | null): void {
    this.selectedSymbolState.set(symbol && this.symbols().includes(symbol) ? symbol : null);
    if (this.status() === 'ready') this.syncSymbols();
  }

  addOrder(input: NewOrder): AddOrderResult {
    if (
      this.status() !== 'ready' ||
      !this.symbols().includes(input.symbol) ||
      !this.contractSizes().has(input.symbol) ||
      (input.side !== 'BUY' && input.side !== 'SELL') ||
      !Number.isFinite(input.size) ||
      input.size <= 0 ||
      !Number.isFinite(input.openTime) ||
      !Number.isFinite(new Date(input.openTime).getTime())
    ) {
      return { error: 'Sprawdź symbol, stronę, dodatni wolumen i czas otwarcia.' };
    }
    const quote = this.quotes().get(input.symbol);
    if (!quote || quote.bid <= 0 || !this.quoteService.isFresh(input.symbol)) {
      return { error: 'Dodanie wymaga świeżego kwotowania. Poczekaj na bieżącą cenę.' };
    }
    if (!Number.isSafeInteger(this.nextId)) return { error: 'Wyczerpano zakres numerów zleceń.' };
    const order: Order = { ...input, id: this.nextId++, openPrice: quote.bid, swap: 0 };
    this.orderState.update((orders) => [...orders, order]);
    this.syncSymbols();
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
      this.syncSymbols();
    }
    return removed.map((order) => order.id);
  }

  private syncSymbols(): void {
    const symbols = new Set(this.orders().map((order) => order.symbol));
    const selected = this.selectedSymbol();
    if (selected) symbols.add(selected);
    this.quoteService.setSymbols(symbols);
  }
}
