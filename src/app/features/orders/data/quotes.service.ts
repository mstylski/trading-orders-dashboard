import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { ConnectionStatus, Quote, Quotes } from '../models/order.models';
import { QUOTES_URL, QuoteSocket } from './quote-socket';
import { isFiniteNumber, isRecord } from './validation';

@Injectable()
export class QuotesService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly quoteState = signal<Quotes>(new Map());
  private readonly statusState = signal<ConnectionStatus>('idle');
  private readonly freshSymbols = signal<ReadonlySet<string>>(new Set());
  private readonly retryDelayState = signal<number | null>(null);
  private desiredSymbols = new Set<string>();
  private subscribedSymbols = new Set<string>();
  private socket: QuoteSocket | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private connectionTimer: ReturnType<typeof setTimeout> | undefined;
  private retryAttempt = 0;

  readonly quotes = this.quoteState.asReadonly();
  readonly status = this.statusState.asReadonly();
  readonly retryDelay = this.retryDelayState.asReadonly();

  constructor() {
    this.destroyRef.onDestroy(() => this.dispose());
  }

  setSymbols(symbols: Iterable<string>): void {
    if (this.destroyRef.destroyed) return;
    this.desiredSymbols = new Set(symbols);
    this.freshSymbols.update(
      (fresh) => new Set([...fresh].filter((symbol) => this.desiredSymbols.has(symbol))),
    );
    if (this.status() === 'idle') {
      this.connect();
    } else {
      this.syncSubscriptions();
    }
  }

  isFresh(symbol: string): boolean {
    return this.status() === 'connected' && this.freshSymbols().has(symbol);
  }

  private connect(): void {
    if (this.destroyRef.destroyed) return;
    this.statusState.set(this.retryAttempt ? 'reconnecting' : 'connecting');
    this.retryDelayState.set(null);
    let socket: QuoteSocket;
    try {
      socket = new WebSocket(QUOTES_URL);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    this.connectionTimer = setTimeout(() => this.disconnect(socket), 10_000);
    socket.onopen = () => {
      if (this.socket !== socket || this.destroyRef.destroyed) return;
      clearTimeout(this.connectionTimer);
      this.connectionTimer = undefined;
      this.retryAttempt = 0;
      this.statusState.set('connected');
      this.syncSubscriptions();
    };
    socket.onmessage = (event) => {
      if (this.socket === socket && this.status() === 'connected') this.receive(event.data);
    };
    socket.onerror = () => this.disconnect(socket);
    socket.onclose = () => this.disconnect(socket);
  }

  private syncSubscriptions(): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== 1) return;
    const removed = [...this.subscribedSymbols].filter(
      (symbol) => !this.desiredSymbols.has(symbol),
    );
    const added = [...this.desiredSymbols].filter((symbol) => !this.subscribedSymbols.has(symbol));
    try {
      if (removed.length) socket.send(JSON.stringify({ p: '/subscribe/removelist', d: removed }));
      if (added.length) socket.send(JSON.stringify({ p: '/subscribe/addlist', d: added }));
      this.subscribedSymbols = new Set(this.desiredSymbols);
    } catch {
      this.disconnect(socket);
    }
  }

  private receive(data: unknown): void {
    if (typeof data !== 'string') return;
    let message: unknown;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    if (!isRecord(message) || message['p'] !== '/quotes/subscribed' || !Array.isArray(message['d']))
      return;
    const quotes = new Map(this.quotes());
    const fresh = new Set(this.freshSymbols());
    let changed = false;
    for (const item of message['d'] as unknown[]) {
      const quote = this.toQuote(item);
      if (!quote) continue;
      const previous = quotes.get(quote.symbol);
      if (previous && previous.timestamp > quote.timestamp) continue;
      quotes.set(quote.symbol, quote);
      fresh.add(quote.symbol);
      changed = true;
    }
    if (changed) {
      this.quoteState.set(quotes);
      this.freshSymbols.set(fresh);
    }
  }

  private toQuote(item: unknown): Quote | null {
    if (
      !isRecord(item) ||
      typeof item['s'] !== 'string' ||
      !this.subscribedSymbols.has(item['s']) ||
      !isFiniteNumber(item['b']) ||
      item['b'] < 0 ||
      !isFiniteNumber(item['a']) ||
      item['a'] < 0 ||
      !isFiniteNumber(item['t']) ||
      item['t'] < 0 ||
      !Number.isFinite(item['t'] * 1000)
    )
      return null;
    return {
      symbol: item['s'],
      bid: item['b'],
      ask: item['a'],
      timestamp: item['t'] * 1000,
    };
  }

  private disconnect(socket: QuoteSocket): void {
    if (this.socket !== socket || this.destroyRef.destroyed) return;
    this.releaseSocket();
    this.freshSymbols.set(new Set());
    this.subscribedSymbols.clear();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.destroyRef.destroyed) return;
    this.statusState.set('reconnecting');
    const delay = Math.min(1000 * 2 ** Math.min(this.retryAttempt++, 5), 30_000);
    this.retryDelayState.set(delay / 1000);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.connect();
    }, delay);
  }

  private releaseSocket(): void {
    clearTimeout(this.connectionTimer);
    this.connectionTimer = undefined;
    if (this.socket) {
      this.socket.onopen = this.socket.onmessage = this.socket.onerror = this.socket.onclose = null;
      this.socket.close();
      this.socket = null;
    }
  }

  private dispose(): void {
    clearTimeout(this.retryTimer);
    this.releaseSocket();
    this.freshSymbols.set(new Set());
    this.statusState.set('idle');
  }
}
