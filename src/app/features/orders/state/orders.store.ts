import {
  computed,
  DestroyRef,
  effect,
  inject,
  Injectable,
  PLATFORM_ID,
  RESPONSE_INIT,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { catchError, defer, finalize, map, Observable, of } from 'rxjs';
import { ApiErrorCode } from '../../../../../api/contracts/api-error-code';
import { OrdersApiService } from '../data/orders-api.service';
import { InvalidPayloadError } from '../data/order.guards';
import { isRecord } from '../../../shared/util/type-guards';
import { QuotesService } from '../data/quotes.service';
import { applyQuotes, buildContractSizes, prepareOrderGroups } from '../domain/orders';
import {
  AddOrderResult,
  ContractSizeBySymbol,
  CreateOrderRequest,
  LoadStatus,
  NewOrder,
  Order,
  OrdersData,
  PriceUnavailableReason,
} from '../models/order.models';
import {
  LegacyPendingOrder,
  PendingOrder,
  readLegacyPending,
  readPending,
  sameOrder,
  validInput,
} from './orders.store.helpers';

export const PENDING_ORDER_STORAGE_KEY = 'trading-orders.pending-order.v1';

@Injectable()
export class OrdersStore {
  private readonly api = inject(OrdersApiService);
  private readonly quoteService = inject(QuotesService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly responseInit = inject(RESPONSE_INIT, { optional: true });
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly pendingState = signal<PendingOrder | null>(null);
  private readonly legacyPendingState = signal<LegacyPendingOrder | null>(null);
  private readonly orderState = signal<readonly Order[]>([]);
  private readonly symbolState = signal<readonly string[]>([]);
  private readonly contractState = signal<ContractSizeBySymbol>(new Map());
  private readonly loadingState = signal<LoadStatus>('idle');
  private readonly errorState = signal<string | null>(null);
  private readonly selectedSymbolState = signal<string | null>(null);
  private readonly savingState = signal(false);

  // Read models for the page and its form.
  readonly orders = this.orderState.asReadonly();
  readonly symbols = this.symbolState.asReadonly();
  readonly contractSizes = this.contractState.asReadonly();
  readonly status = this.loadingState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly selectedSymbol = this.selectedSymbolState.asReadonly();
  readonly saving = this.savingState.asReadonly();
  readonly pendingOrder = computed(() => this.pendingState()?.request ?? null);
  readonly legacyPending = this.legacyPendingState.asReadonly();
  readonly quotes = this.quoteService.quotes;
  readonly connectionStatus = this.quoteService.status;
  readonly retryDelay = this.quoteService.retryDelay;
  readonly quoteFreshness = computed(() => {
    const quotes = this.quotes();
    const fresh = this.quoteService.fresh();
    const connected = this.connectionStatus() === 'connected';
    return new Map(
      this.groups().map(
        (group) =>
          [
            group.symbol,
            !quotes.has(group.symbol)
              ? 'waiting'
              : connected && fresh.has(group.symbol)
                ? 'current'
                : 'stale',
          ] as const,
      ),
    );
  });
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
  private readonly desiredSymbols = computed(() => {
    if (this.status() !== 'ready') return null;
    const symbols = new Set(this.orders().map((order) => order.symbol));
    const selected = this.selectedSymbol();
    if (selected) symbols.add(selected);
    return symbols;
  });

  constructor() {
    if (this.browser) {
      effect(() => {
        const symbols = this.desiredSymbols();
        if (symbols) untracked(() => this.quoteService.setSymbols(symbols));
      });
    }
  }

  // Called after browser hydration. A pending write can already have committed,
  // so restoration must retain both its key and the original quoted price.
  restorePendingOrder(): CreateOrderRequest | null {
    if (!this.browser) return null;
    try {
      const stored = sessionStorage.getItem(PENDING_ORDER_STORAGE_KEY);
      if (stored) {
        const raw: unknown = JSON.parse(stored);
        const legacy = readLegacyPending(raw);
        this.legacyPendingState.set(legacy);
        if (legacy) return null;
        const pending = readPending(raw);
        this.pendingState.set(pending);
        if (!pending) sessionStorage.removeItem(PENDING_ORDER_STORAGE_KEY);
      }
    } catch {
      // Ignore unavailable storage or malformed JSON; keep any in-memory attempt.
    }
    const request = this.pendingOrder();
    if (request) this.selectedSymbolState.set(request.symbol);
    return request;
  }

  private setPendingOrder(pending: PendingOrder | null): void {
    this.pendingState.set(pending);
    if (!this.browser) return;
    try {
      if (pending) sessionStorage.setItem(PENDING_ORDER_STORAGE_KEY, JSON.stringify(pending));
      else sessionStorage.removeItem(PENDING_ORDER_STORAGE_KEY);
    } catch {
      // Storage may be blocked; the in-memory attempt still supports retries.
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
    this.symbolState.set(instruments.map((instrument) => instrument.symbol));
    this.contractState.set(buildContractSizes(instruments, contracts));
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

  // The server assigns IDs. Append only the confirmed response.
  addOrder(input: NewOrder): Observable<AddOrderResult> {
    return defer(() => this.createOrder(input));
  }

  resolveLegacyOrder(): Observable<AddOrderResult> {
    return defer(() => {
      if (this.saving()) return of<AddOrderResult>({ error: 'saving' });
      const pending = this.legacyPending();
      if (!pending) return of<AddOrderResult>({ error: 'invalid-input' });
      this.savingState.set(true);
      return this.api.resolveCreation(pending.key).pipe(
        takeUntilDestroyed(this.destroyRef),
        map((order): AddOrderResult => {
          if (
            !sameOrder(order, pending.request) ||
            order.openPrice !== pending.request.openPrice ||
            order.openTime !== pending.request.openTime
          ) {
            throw new InvalidPayloadError('orders');
          }
          this.orderState.update((orders) =>
            orders.some((existing) => existing.id === order.id) ? orders : [...orders, order],
          );
          this.legacyPendingState.set(null);
          this.setPendingOrder(null);
          return { order };
        }),
        catchError((error: unknown) =>
          of<AddOrderResult>({
            error:
              error instanceof HttpErrorResponse && error.status === 404
                ? 'operation-not-found'
                : 'save-failed',
          }),
        ),
        finalize(() => this.savingState.set(false)),
      );
    });
  }

  private createOrder(input: NewOrder): Observable<AddOrderResult> {
    if (this.saving()) return of({ error: 'saving' });
    if (this.legacyPending()) return of({ error: 'legacy-pending' });
    if (this.status() !== 'ready' || !validInput(input)) {
      return of({ error: 'invalid-input' });
    }
    let pending = this.pendingState();
    // An uncertain request may already be committed. Only confirmation of that
    // snapshot is allowed until its outcome is known; edits cannot replace it.
    if (pending && !sameOrder(pending.request, input)) return of({ error: 'invalid-input' });
    if (!pending) {
      if (!this.symbols().includes(input.symbol)) return of({ error: 'invalid-input' });
      if (!this.contractSizes().has(input.symbol)) return of({ error: 'missing-contract' });
      const quote = this.quotes().get(input.symbol);
      if (!quote || quote.bid <= 0 || !this.quoteService.isFresh(input.symbol)) {
        return of({ error: 'stale-quote' });
      }
      pending = {
        key: crypto.randomUUID(),
        request: {
          symbol: input.symbol,
          side: input.side,
          size: input.size,
          openPrice: quote.bid,
        },
      };
      // Persist before starting HTTP, including when navigation cancels the client.
      this.setPendingOrder(pending);
    }
    this.savingState.set(true);
    return this.api.create(pending.request, pending.key).pipe(
      takeUntilDestroyed(this.destroyRef),
      map((order): AddOrderResult => {
        this.orderState.update((orders) =>
          orders.some((existing) => existing.id === order.id) ? orders : [...orders, order],
        );
        this.setPendingOrder(null);
        return { order };
      }),
      catchError((error: unknown) => this.handleCreateOrderError(error)),
      finalize(() => this.savingState.set(false)),
    );
  }

  private handleCreateOrderError(error: unknown): Observable<AddOrderResult> {
    if (error instanceof HttpErrorResponse && [400, 404, 409].includes(error.status)) {
      this.setPendingOrder(null);
    }
    return of<AddOrderResult>({
      error:
        error instanceof HttpErrorResponse && error.status === 404
          ? 'unknown-symbol'
          : error instanceof HttpErrorResponse && error.status === 400
            ? 'invalid-input'
            : error instanceof HttpErrorResponse &&
                error.status === 409 &&
                isRecord(error.error) &&
                error.error['code'] === ApiErrorCode.IdempotencyKeyReused
              ? 'idempotency-conflict'
              : 'save-failed',
    });
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
