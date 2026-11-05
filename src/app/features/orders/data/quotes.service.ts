import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { ConnectionStatus, Quote, Quotes } from '../models/order.models';
import { QUOTES_URL, QUOTE_SOCKET_FACTORY, QuoteSocket } from './quote-socket';
import { parseQuoteMessage } from './quote-message.guards';

const CONNECT_TIMEOUT_MS = 10_000;
const INITIAL_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 30_000;
const MAX_BACKOFF_EXPONENT = 5;
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;

@Injectable()
export class QuotesService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly createSocket = inject(QUOTE_SOCKET_FACTORY);
  private readonly quoteState = signal<Quotes>(new Map());
  private readonly statusState = signal<ConnectionStatus>('idle');
  private readonly freshSymbols = signal<ReadonlySet<string>>(new Set());
  private readonly retryDelayState = signal<number | null>(null);
  private desiredSymbols = new Set<string>();
  private subscribedSymbols = new Set<string>();
  private socket: QuoteSocket | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private connectionTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeatTimeout: ReturnType<typeof setTimeout> | undefined;
  private retryAttempt = 0;

  readonly quotes = this.quoteState.asReadonly();
  readonly fresh = this.freshSymbols.asReadonly();
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
      socket = this.createSocket(QUOTES_URL);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    this.connectionTimer = setTimeout(() => this.disconnect(socket), CONNECT_TIMEOUT_MS);
    socket.onopen = () => {
      if (this.socket !== socket || this.destroyRef.destroyed) return;
      clearTimeout(this.connectionTimer);
      this.connectionTimer = undefined;
      this.retryAttempt = 0;
      this.statusState.set('connected');
      this.syncSubscriptions();
      this.scheduleHeartbeat(socket);
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket || this.status() !== 'connected') return;
      const { quotes, acknowledged } = parseQuoteMessage(event.data, this.subscribedSymbols);
      if (acknowledged) this.acknowledgeHeartbeat(socket);
      this.receive(quotes);
    };
    socket.onerror = () => this.disconnect(socket);
    socket.onclose = () => this.disconnect(socket);
  }

  private scheduleHeartbeat(socket: QuoteSocket): void {
    clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = setTimeout(() => {
      this.heartbeatTimer = undefined;
      if (this.socket !== socket || this.status() !== 'connected') return;
      try {
        socket.send(JSON.stringify({ p: '/subscribe/addlist', d: [...this.subscribedSymbols] }));
      } catch {
        this.disconnect(socket);
        return;
      }
      this.heartbeatTimeout = setTimeout(() => this.disconnect(socket), HEARTBEAT_TIMEOUT_MS);
    }, HEARTBEAT_INTERVAL_MS);
  }

  private acknowledgeHeartbeat(socket: QuoteSocket): void {
    if (!this.heartbeatTimeout) return;
    clearTimeout(this.heartbeatTimeout);
    this.heartbeatTimeout = undefined;
    this.scheduleHeartbeat(socket);
  }

  private syncSubscriptions(): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
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

  private receive(incoming: readonly Quote[]): void {
    if (!incoming.length) return;
    const quotes = new Map(this.quotes());
    const fresh = new Set(this.freshSymbols());
    let changed = false;
    for (const quote of incoming) {
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
    const delay = Math.min(
      INITIAL_RETRY_DELAY_MS * 2 ** Math.min(this.retryAttempt++, MAX_BACKOFF_EXPONENT),
      MAX_RETRY_DELAY_MS,
    );
    this.retryDelayState.set(delay / 1000);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.connect();
    }, delay);
  }

  private releaseSocket(): void {
    clearTimeout(this.connectionTimer);
    clearTimeout(this.heartbeatTimer);
    clearTimeout(this.heartbeatTimeout);
    this.connectionTimer = undefined;
    this.heartbeatTimer = undefined;
    this.heartbeatTimeout = undefined;
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
